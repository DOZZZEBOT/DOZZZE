// Re-export the shared protocol schema from @dozzze/sdk so existing local
// imports (./protocol.js) keep compiling. Future work should import from
// @dozzze/sdk directly — this file is a compatibility shim.
export * from '@dozzze/sdk';
