// Opt-in signing configuration for the main-only Windows verification workflow.
const { build } = require("./package.json");

module.exports = {
  ...build,
  forceCodeSigning: true,
  win: {
    ...build.win,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder expands these macros.
    artifactName: "${productName}-${version}-${arch}-${target}.${ext}",
    signtoolOptions: {
      sign: "./scripts/sign-windows.cjs",
      signingHashAlgorithms: ["sha256"],
      publisherName: "Ricos Labs LLC",
    },
  },
};
