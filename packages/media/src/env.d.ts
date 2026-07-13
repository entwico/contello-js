// declares NODE_ENV as a concrete property so `process.env.NODE_ENV` stays dot-accessed
// (noPropertyAccessFromIndexSignature) — bundlers only statically replace the dot form.
// local to typechecking; not part of the published dist types.
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: string;
  }
}
