module.exports = {
  apps: [
    {
      name: "wamf",
      script: "./dist/index.js",
      env: {
        NODE_ENV: "production",
      },
      interpreter: "/usr/bin/node",
      //   interpreter: "node@20.18.0",

      instances: 2,
      exec_mode: "cluster",

      wait_ready: true,
      listen_timeout: 10000,

      update_env: true,
    },
  ],
};
