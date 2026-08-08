// Several modules (e.g. PersistenceManager) log diagnostic console.log/console.error chatter
// on every call, including on expected/asserted-against error paths. None of the tests assert
// on that output, and left unmocked it makes real failures harder to spot in the noise -
// silence it globally rather than have every test file do this itself.
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});
