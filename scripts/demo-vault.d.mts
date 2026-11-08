// Types for src/demoVault.test.ts, which imports the generator.

/** Top-level paths the generator owns. --reset deletes exactly these. */
export declare const GENERATED: string[];

/** Every note in the demo vault, keyed by vault path. `today` is YYYY-MM-DD. */
export declare function demoVaultFiles(today: string): Record<string, string>;
