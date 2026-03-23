module.exports = {
  apps: [
    { name: "organizapay", script: "server.js", env: { NODE_ENV: "production", PORT: 3000 } }
  ]
};
