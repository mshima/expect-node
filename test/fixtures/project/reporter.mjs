// A reporter of its own: the names of the tests passed, a line each.
export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type === 'test:pass') yield `passed ${event.data.name}\n`;
  }
}
