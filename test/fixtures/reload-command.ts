/** Test fixture: `/do-reload` runs the same flow as the interactive `/reload`. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("do-reload", {
		description: "Reload the runtime",
		handler: async (_args, ctx) => {
			await ctx.reload();
		},
	});
}
