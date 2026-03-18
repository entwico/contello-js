export function uncapitalize(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export function pascalCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function deriveModelName(typeName: string): string | undefined {
  for (const suffix of ['Entity', 'Component']) {
    if (typeName.endsWith(suffix)) {
      return uncapitalize(typeName.slice(0, -suffix.length));
    }
  }

  return undefined;
}

export function isContelloModel(schema: { getType(name: string): unknown }, typeName: string): boolean {
  for (const unionName of ['ContelloEntity', 'ContelloComponent']) {
    const union = schema.getType(unionName);

    if (union && typeof union === 'object' && 'getTypes' in union) {
      const members = (union as { getTypes(): { name: string }[] }).getTypes();

      if (members.some((m) => m.name === typeName)) {
        return true;
      }
    }
  }

  return false;
}
