import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * Generates TypeScript types FROM schema.graphqls — the backend's schema
 * file is the single source of truth, and `npm run codegen` turns any
 * server-side field rename/retype into a frontend COMPILE error instead
 * of a runtime surprise (types.ts derives its shapes from the output).
 *
 * Run after every schema change; the generated file is committed so
 * plain builds don't depend on codegen.
 */
const config: CodegenConfig = {
  schema: "../src/main/resources/graphql/schema.graphqls",
  generates: {
    "src/generated/schema.ts": {
      plugins: ["typescript"],
      config: {
        // Our DateTime rides as an ISO string in JSON.
        scalars: { DateTime: "string" },
        // Unions, not TS enums: erasable types only (verbatimModuleSyntax).
        enumsAsTypes: true,
        skipTypename: true,
      },
    },
  },
};

export default config;
