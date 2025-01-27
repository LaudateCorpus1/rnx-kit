/* jshint esversion: 8, node: true */
// @ts-check
"use strict";

const { types } = require("@babel/core");
const { declare } = require("@babel/helper-plugin-utils");

/**
 * @template T
 * @typedef {import("@babel/core").NodePath<T>} NodePath;
 */

/**
 * @typedef {import("@babel/core").types.CallExpression} CallExpression;
 * @typedef {import("@babel/core").types.ExportAllDeclaration} ExportAllDeclaration;
 * @typedef {import("@babel/core").types.ExportNamedDeclaration} ExportNamedDeclaration;
 * @typedef {import("@babel/core").types.ImportDeclaration} ImportDeclaration;
 * @typedef {import("@babel/core").types.Node} Node;
 * @typedef {
 *   | NodePath<ExportAllDeclaration>
 *   | NodePath<ExportNamedDeclaration>
 *   | NodePath<ImportDeclaration>
 * } ImportExportDeclarationNodePath;
 */

/**
 * Finds the main source file in the specified package's manifest.
 * @param {string} sourcePath
 * @returns {string | undefined}
 */
function findMainSourceFile(sourcePath) {
  const { main } = require(`${sourcePath}/package.json`);
  if (!main) {
    return;
  }

  const remappedPath = `${sourcePath}/${main.replace(
    /^(?:\.\/)?lib\/(.*)\.js/,
    "src/$1.ts"
  )}`;
  try {
    const tsx = `${remappedPath}x`;
    require.resolve(tsx);
    return tsx;
  } catch (_) {
    return remappedPath;
  }
}

/**
 * Replaces the source string in specified call expression.
 * @param {NodePath<CallExpression>} path
 * @param {string} source
 */
function replaceCallWith(path, source) {
  const expression = types.isImport(path.node.callee)
    ? types.import()
    : types.identifier("require");
  path.replaceWith(
    types.callExpression(expression, [types.stringLiteral(source)])
  );
}

/**
 * Replaces the source string in specified import/export declaration.
 * @param {NodePath<Node>} path
 * @param {string} source
 */
function replaceDeclarationWith(path, source) {
  path.replaceWith(
    (() => {
      switch (path.node.type) {
        case "ExportAllDeclaration":
          return types.exportAllDeclaration(types.stringLiteral(source));
        case "ExportNamedDeclaration":
          return types.exportNamedDeclaration(
            path.node.declaration,
            path.node.specifiers,
            types.stringLiteral(source)
          );
        case "ImportDeclaration":
          return types.importDeclaration(
            path.node.specifiers,
            types.stringLiteral(source)
          );
        default:
          throw new Error(`Unhandled declaration type: ${path.node.type}`);
      }
    })()
  );
}

module.exports = declare((api, options) => {
  api.assertVersion(7);

  /** @type {{ test?: (source: string) => boolean; }} */
  const { test } = options;
  if (typeof test !== "function") {
    throw new Error(
      "Expected option `test` to be a function `(source: string) => boolean`"
    );
  }

  const re = /(.*?)\/lib/;
  const replacement = "$1/src";

  return {
    name: "import-path-remapper",
    visitor: {
      CallExpression: (path, _state) => {
        if (
          !types.isImport(path.node.callee) &&
          (!types.isIdentifier(path.node.callee) ||
            path.node.callee.name !== "require")
        ) {
          return;
        }

        const arg = path.node.arguments[0];
        const sourcePath = arg && types.isStringLiteral(arg) && arg.value;
        if (!sourcePath || !test(sourcePath)) {
          return;
        }

        if (sourcePath.includes("/lib")) {
          // Remaps @scope/example/lib/index.js -> @scope/example/src/index.ts
          replaceCallWith(path, sourcePath.replace(re, replacement));
        } else {
          // Remaps @scope/example -> @scope/example/src/index.ts
          try {
            const mainSourceFile = findMainSourceFile(sourcePath);
            if (mainSourceFile) {
              replaceCallWith(path, mainSourceFile);
            }
          } catch (_) {
            /* ignore */
          }
        }
      },

      /** @type {(path: ImportExportDeclarationNodePath, state: unknown) => void} */
      "ImportDeclaration|ExportDeclaration": (path, _state) => {
        if (!path.node.source) {
          // Ignore non-re-export lines, e.g.: export const example = () => { ... }
          return;
        }

        const sourcePath = path.node.source.value;
        if (!test(sourcePath)) {
          return;
        }

        if (sourcePath.includes("/lib")) {
          // Remaps @scope/example/lib/index.js -> @scope/example/src/index.ts
          replaceDeclarationWith(path, sourcePath.replace(re, replacement));
        } else {
          // Remaps @scope/example -> @scope/example/src/index.ts
          try {
            const mainSourceFile = findMainSourceFile(sourcePath);
            if (mainSourceFile) {
              replaceDeclarationWith(path, mainSourceFile);
            }
          } catch (_) {
            /* ignore */
          }
        }
      },
    },
  };
});
