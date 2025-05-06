module.exports = {
  apps: [
    {
      name: "pdp-1",
      script: "./dist/index.js",
      args: "-c 10000 -l 20000",
      node_args: "--max-old-space-size=8192",
    },
    {
      name: "pdp-2",
      script: "./dist/index.js",
      args: "-c 10000 -l 20000",
      node_args: "--max-old-space-size=8192",
    },
    {
      name: "pdp-3",
      script: "./dist/index.js",
      args: "-c 10000 -l 20000",
      node_args: "--max-old-space-size=8192",
    },
    {
      name: "pdp-4",
      script: "./dist/index.js",
      args: "-c 10000 -l 20000",
      node_args: "--max-old-space-size=8192",
    },
    {
      name: "pdp-5",
      script: "./dist/index.js",
      args: "-c 10000 -l 20000",
      node_args: "--max-old-space-size=8192",
    },
    {
      name: "pdp-6",
      script: "./dist/index.js",
      args: "-c 10000 -l 20000",
      node_args: "--max-old-space-size=8192",
    },
    {
      name: "plp-1",
      script: "./dist/index.js",
      args: "-l 5000 -t plp",
      node_args: "--max-old-space-size=8192",
    },
  ],
};
