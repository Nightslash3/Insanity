import settings from "./settings.jsx";
import * as common from "../../common";
import { FluxDispatcher, moment, React } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { before as patchBefore, after as patchAfter } from "@vendetta/patcher";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { findInReactTree } from "@vendetta/utils";
import { showToast } from "@vendetta/ui/toasts";
import { getTranslation, massive } from "./translations.js";
import { semanticColors } from "@vendetta/ui";
//import { dispatcherPatch } from "./patches/dispatcher.js";
//import { contextMenuPatch } from "./patches/contextMenu.js"

common.makeDefaults(storage, {
	ignore: {
		users: [],
		channels: [],
		bots: false,
	},
	timestamps: false,
	ew: false,
	onlyTimestamps: false,
});
let MessageStore,
	deleteable = [];

// Track deleted message IDs for styling
export const deletedMessages = new Set();


export default {
	settings,
	patches: [
		//()=>deleteable=[]
	],
	onUnload() {
		this.patches.forEach((up) => up()); // unpatch every patch
		this.patches = [];
	},
	onLoad() {
		//		this.patches.push(
		//			dispatcherPatch(),
		//			contextMenuPatch()
		//		);

		try {
			this.patches.push(
				patchBefore("dispatch", FluxDispatcher, (args) => {
					try {
						if (!MessageStore) MessageStore = findByStoreName("MessageStore");
						const event = args[0];

						if (!event || event?.type !== "MESSAGE_DELETE") return;
						if (!event?.id || !event?.channelId) return;

						const message = MessageStore.getMessage(event.channelId, event.id);

						if (storage["ignore"]["users"].includes(message?.author?.id)) return;
						if (storage["ignore"]["bots"] && message?.author?.bot) return;

						if (deleteable.includes(event.id)) {
							deleteable.splice(deleteable.indexOf(event.id), 1);
							return args;
						}
						deleteable.push(event.id);
						
						// Track this message as deleted for styling
						deletedMessages.add(event.id);

						// Get the deleted indicator text
						let deletedIndicator = ` (${getTranslation("deleted")})`;
						if (storage["timestamps"]) {
							deletedIndicator = ` (${getTranslation("deleted")} ${moment().format(storage["ew"] ? "hh:mm:ss a" : "HH:mm:ss")})`;
						}

						// Dispatch a MESSAGE_UPDATE to modify the message content with deleted indicator
						args[0] = {
							type: "MESSAGE_UPDATE",
							message: {
								id: event.id,
								channel_id: event.channelId,
								content: message.content + deletedIndicator,
								guild_id: message.guild_id,
							},
						};
						return args;
					} catch (e) {
						console.error(e);
						alert("[Nodelete → dispatcher patch] died\n" + e.stack);
					}
				})
			);

			// Patch message content to style deleted messages with red color
			try {
				const MessageContent = findByName("MessageContent", false);
				if (MessageContent) {
					this.patches.push(
						patchAfter("default", MessageContent, (args, res) => {
							try {
								const message = args[0]?.message;
								if (!message?.id || !deletedMessages.has(message.id)) return;
								
								// Apply red color style to the message content
								const applyRedStyle = (node) => {
									if (!node) return;
									if (node.props) {
										node.props.style = [
											node.props.style,
											{ color: "#f04747" } // Discord red color
										].flat().filter(Boolean);
									}
									if (node.props?.children) {
										if (Array.isArray(node.props.children)) {
											node.props.children.forEach(applyRedStyle);
										} else if (typeof node.props.children === "object") {
											applyRedStyle(node.props.children);
										}
									}
								};
								applyRedStyle(res);
							} catch (e) {
								console.error("[NoDelete → message style patch]", e);
							}
						})
					);
				}
			} catch (e) {
				console.error("[NoDelete] Failed to patch message content styling:", e);
			}

			/* thanks fres#2400 (<@843448897737064448>) for example patch
			 * add ignore user button
			 */
			const contextMenuUnpatch = patchBefore("render", findByProps("ScrollView").View, (args) => {
				try {
					let a = findInReactTree(args, (r) => r.key === ".$UserProfileOverflow");
					if (!a || !a.props || a.props.sheetKey !== "UserProfileOverflow") return;
					const props = a.props.content.props;
					const _labels = massive.optionLabels.map(Object.values).flat();
					if (props.options.some((option) => _labels.includes(option?.label))) return;

					const focusedUserId = Object.keys(a._owner.stateNode._keyChildMapping)
						.find((str) => a._owner.stateNode._keyChildMapping[str] && str.match(/(?<=\$UserProfile)\d+/))
						?.slice?.(".$UserProfile".length);

					let optionPosition = props.options.findLastIndex((option) => option.isDestructive);
					if (!storage["ignore"]["users"].includes(focusedUserId)) {
						props.options.splice(optionPosition + 1, 0, {
							isDestructive: true,
							label: getTranslation("optionLabels.0"), // START IGNORING
							onPress: () => {
								storage["ignore"]["users"].push(focusedUserId);
								showToast(getTranslation("toastLabels.0").replaceAll("${user}", props.header.title));

								props.hideActionSheet();
							},
						});
					} else {
						props.options.splice(optionPosition + 1, 0, {
							label: getTranslation("optionLabels.1"), // STOP IGNORING
							onPress: () => {
								storage["ignore"]["users"].splice(
									storage["ignore"]["users"].findIndex((userId) => userId === focusedUserId),
									1
								);
								showToast(getTranslation("toastLabels.1").replaceAll("${user}", props.header.title));

								props.hideActionSheet();
							},
						});
					}
				} catch (e) {
					console.error(e);
					let successful = false;
					try {
						successful = contextMenuUnpatch();
					} catch (e) {
						successful = false;
					}
					alert(`[NoDelete → context menu patch] failed. Patch ${successful ? "dis" : "en"}abled\n` + e.stack);
				}
			});
			this.patches.push(contextMenuUnpatch);
		} catch (e) {
			console.error(e);
			alert("[NoDelete] dead\n" + e.stack);
		}
	},
};
