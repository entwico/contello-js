# @contello/client

## 1.2.2

### Patch Changes

- 0f14d49: reference fragment types by name in generated operation/fragment types

## 1.2.1

### Patch Changes

- dfe5645: prevent errors on `ContelloComponent` recursion and unused fragments during `contello-client generate`

## 1.2.0

### Minor Changes

- dcf1311: validate user .gql documents against the schema during `contello-client generate`

### Patch Changes

- 062116a: properly resolve component refs nested inside wrapper objects

## 1.1.1

### Patch Changes

- 081881a: fix: reword "connection pool is empty" error to reference the public `client.init()` method instead of the internal `connect()`

## 1.1.0

### Minor Changes

- 7d27ca2: switch asset traffic to pooled undici HTTP/2 agent, add `proxyHls()`

### Patch Changes

- 3ac4fb8: emit `_flat_<field>` companion when a `ContelloComponent` field is populated through a fragment spread from an entity/attributes-level fragment

## 1.0.3

### Patch Changes

- d465577: check overlappings on fragment

## 1.0.2

### Patch Changes

- c3bebfc: better colored output in generator

## 1.0.1

### Patch Changes

- f0fb00d: update deps & switch to pnpm

## 1.0.0

### Major Changes

- c5d485c: init
