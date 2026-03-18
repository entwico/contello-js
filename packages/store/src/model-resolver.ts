export class ModelResolver<TModels extends string = string> {
  private _typeNames: ReadonlySet<string> | undefined;
  private _toModel: ReadonlyMap<string, TModels>;
  private _toTypeName: ReadonlyMap<TModels, string>;

  constructor(models?: Record<TModels, string> | undefined) {
    const toModel = new Map<string, TModels>();
    const toTypeName = new Map<TModels, string>();
    let typeNames: Set<string> | undefined;

    if (models) {
      typeNames = new Set<string>();

      for (const [model, typeName] of Object.entries<string>(models)) {
        toModel.set(typeName, model as TModels);
        toTypeName.set(model as TModels, typeName);
        typeNames.add(typeName);
      }
    }

    this._typeNames = typeNames;
    this._toModel = toModel;
    this._toTypeName = toTypeName;
  }

  hasTypeName(typeName: string): boolean {
    return !this._typeNames || this._typeNames.has(typeName);
  }

  getModel(typeName: string): TModels | undefined {
    return this._toModel.get(typeName);
  }

  getTypeName(model: TModels): string {
    return this._toTypeName.get(model) ?? model;
  }

  hasModel(model: string): boolean {
    return !this._toTypeName.size || this._toTypeName.has(model as TModels);
  }

  resolveModel(typeName: string): string {
    return this._toModel.get(typeName) ?? typeName;
  }
}
