export {}; // for the top-level await

const command = process.argv[2];

switch (command) {
  case 'generate':
    await import('./generate/index');

    break;

  default:
    console.error(command ? `unknown command: ${command}` : 'usage: contello-client <command>');
    console.error('');
    console.error('commands:');
    console.error('  generate    generate TypeScript types from GraphQL schema');
    process.exit(1);
}
