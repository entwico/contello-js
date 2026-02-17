export interface ContelloMethods {
  [prop: string]: [unknown, unknown];
}

export interface ContelloClientParentMethods extends ContelloMethods {
  connect: [void, { connected: boolean; data: any }];
  resize: [{ height: number }, void];
  ready: [{ height: number }, void];
  getAuthToken: [void, { token: string }];
  navigate: [{ url: string }, void];
  displayNotification: [{ message: string; type: 'success' | 'error' }, void];
  openDialog: [{ url: string; width: number; data: any }, { id: string }];
  closeDialog: [{ id: string }, void];
  complete: [{ value: any }, void];
}

export interface ContelloCustomPropertyParentMethods extends ContelloClientParentMethods {
  getValue: [void, { value: string }];
  setValue: [{ value: string; valid: boolean }, void];
  getValueByPath: [{ path: string }, { value: any }];
  setValueByPath: [{ path: string; value: any }, void];
}

export type ContelloExtensionPath = string[];

export interface ContelloExtensionQuery {
  [prop: string]: string;
}

export interface ContelloExtensionBreadcrumb {
  label: string;
  url?: string;
}

export interface ContelloExtensionParentMethods extends ContelloClientParentMethods {
  getUrlData: [void, { path: ContelloExtensionPath; query: ContelloExtensionQuery }];
  setBreadcrumbs: [{ breadcrumbs: ContelloExtensionBreadcrumb[] }, void];
}

export interface ContelloClientChildMethods extends ContelloMethods {
  dialogConnect: [{ id: string }, void];
  dialogReady: [{ id: string }, void];
  dialogComplete: [{ id: string; value: any }, void];
}

export interface ContelloCustomPropertyChildMethods extends ContelloClientChildMethods {
  validate: [void, { valid: boolean }];
  newValue: [{ value: string }, void];
}

export type ContelloExtensionChildMethods = ContelloClientChildMethods;
