// Entry point — boots the portal/sync API.
const { createServer } = require('./server');
const { createStore } = require('./store');

const store = createStore();
const port = parseInt(process.env.PORT || '8080', 10);
const server = createServer(store);
server.listen(port, () => {
  console.log(`Nickland Edusoft Cloud listening on :${port} (store: ${store.kind})`);
});

module.exports = { server, store };
