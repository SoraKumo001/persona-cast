// nodejs_compat で使える AsyncLocalStorage の最小限の型 (tsconfig は @types/node を含めていない)
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
