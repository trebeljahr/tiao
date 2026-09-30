// Opt-in signing configuration for the main-only Windows verification workflow.
const { build } = require("./package.json");

module.exports = {
  ...build,
  forceCodeSigning: true,
  nsis: {
    ...build.nsis,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder expands these macros.
    artifactName: "${productName}-${version}-${arch}-nsis.${ext}",
  },
  portable: {
    ...build.portable,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder expands these macros.
    artifactName: "${productName}-${version}-${arch}-portable.${ext}",
  },
  win: {
    ...build.win,
    signtoolOptions: {
      sign: "./scripts/sign-windows.cjs",
      signingHashAlgorithms: ["sha256"],
      publisherName: "Ricos Labs LLC",
    },
  },
};
