// module marker for top-level await
export {};

const command = process.argv[2];

switch (command) {
  case 'generate': {
    // the package is marked side-effect free (except this entry), so the module
    // must be used via its export - a bare import would be tree-shaken away
    const { run } = await import('./generate/index');

    try {
      await run();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }

    break;
  }

  default: {
    console.error(command ? `unknown command: ${command}` : 'usage: contello-client <command>');
    console.error('');
    console.error('commands:');
    console.error('  generate    generate TypeScript types from GraphQL schema');
    process.exit(1);
  }
}
