import {
  CyclicDependencies,
  PluginOptions as CyclicDetectorOptions,
} from "@rnx-kit/metro-plugin-cyclic-dependencies-detector";
import {
  DuplicateDependencies,
  Options as DuplicateDetectorOptions,
} from "@rnx-kit/metro-plugin-duplicates-checker";
import type { Project } from "@rnx-kit/typescript-service";
import { MetroPlugin, MetroSerializer } from "@rnx-kit/metro-serializer";
import { MetroSerializer as MetroSerializerEsbuild } from "@rnx-kit/metro-serializer-esbuild";
import type {
  DeltaResult,
  Dependency,
  Graph,
  Module,
  MixedOutput,
} from "metro";
import type { InputConfigT, SerializerConfigT } from "metro-config";
import { AllPlatforms } from "../../config/lib";
import type { TSProjectInfo } from "./types";

const emptySerializerHook = (_graph: Graph, _delta: DeltaResult): void => {
  // nop
};

function getModuleDependencies(
  module: Module<MixedOutput>
): Record<string, string> {
  // mapping from module name to module file
  const dependencies: Record<string, string> = {};

  // extract each module dependency
  module.dependencies.forEach(
    (value: Dependency, key: string, _map: unknown) => {
      dependencies[key] = value.absolutePath;
    }
  );
  return dependencies;
}

/**
 * Customize the Metro configuration.
 *
 * @param metroConfigReadonly Metro configuration
 * @param detectCyclicDependencies When true, cyclic dependency checking is enabled with a default set of options. Otherwise the object allows for fine-grained control over the detection process.
 * @param detectDuplicateDependencies When true, duplicate dependency checking is enabled with a default set of options. Otherwise, the object allows for fine-grained control over the detection process.
 * @param tsprojectInfo When set, TypeScript validation is enabled during bundling and serving.
 * @param experimental_treeShake When true, experimental tree-shaking is enabled.
 */
export function customizeMetroConfig(
  metroConfigReadonly: InputConfigT,
  detectCyclicDependencies: boolean | CyclicDetectorOptions,
  detectDuplicateDependencies: boolean | DuplicateDetectorOptions,
  tsprojectInfo: TSProjectInfo | undefined,
  experimental_treeShake: boolean
): void {
  //  We will be making changes to the Metro configuration. Coerce from a
  //  type with readonly props to a type where the props are writeable.
  const metroConfig = metroConfigReadonly as InputConfigT;

  const plugins: MetroPlugin[] = [];
  if (typeof detectDuplicateDependencies === "boolean") {
    plugins.push(DuplicateDependencies());
  } else if (typeof detectDuplicateDependencies === "object") {
    plugins.push(DuplicateDependencies(detectDuplicateDependencies));
  }
  if (typeof detectCyclicDependencies === "boolean") {
    plugins.push(CyclicDependencies());
  } else if (typeof detectCyclicDependencies === "object") {
    plugins.push(CyclicDependencies(detectCyclicDependencies));
  }

  if (plugins.length > 0) {
    //  MetroSerializer acts as a CustomSerializer, and it works with both
    //  older and newer versions of Metro. Older versions expect a return
    //  value, while newer versions expect a promise.
    //
    //  Its return type is the union of both the value and the promise.
    //  This makes TypeScript upset because for any given version of Metro,
    //  it's one or the other. Not both.
    //
    //  Since it can handle either scenario, just coerce it to whatever
    //  the current version of Metro expects.
    const serializer = experimental_treeShake
      ? MetroSerializerEsbuild(plugins)
      : (MetroSerializer(plugins) as SerializerConfigT["customSerializer"]);

    metroConfig.serializer.customSerializer = serializer;
  } else {
    delete metroConfig.serializer.customSerializer;
  }

  metroConfig.serializer.experimentalSerializerHook = emptySerializerHook;
  if (tsprojectInfo) {
    const { service, configFileName } = tsprojectInfo;
    const tsprojectByPlatform: Map<AllPlatforms, Project> = new Map();

    const hook = (graph: Graph, delta: DeltaResult): void => {
      // get the target platform for this hook call
      const platform = graph.transformOptions.platform as AllPlatforms;
      if (!platform) {
        return;
      }

      // lookup the TS project for the target platform. if it doesn't exist, create it.
      if (!tsprojectByPlatform.has(platform)) {
        const tsproject = service.openProject(configFileName);

        //  start with an empty project, ignoring the file graph provided by tsconfig.json
        tsproject.removeAllFiles();

        tsprojectByPlatform.set(platform, tsproject);
      }
      const tsproject = tsprojectByPlatform.get(platform)!;

      //  keep the TS project in sync with Metro's file graph
      if (delta.reset) {
        tsproject.removeAllFiles();
      }

      // TODO: create Resolver impl here and pass in
      // TODO: kill off the idea of separating add/update, and combine into 'set' API

      for (const module of delta.added.values()) {
        const dependencies = getModuleDependencies(module);
        tsproject.addFile(module.path, dependencies);
      }
      for (const module of delta.modified.values()) {
        const dependencies = getModuleDependencies(module);
        tsproject.updateFile(module.path, dependencies);
      }
      for (const module of delta.deleted.values()) {
        tsproject.removeFile(module);
      }

      //  validate the project, printing errors to the console
      tsproject.validate();
    };

    metroConfig.serializer.experimentalSerializerHook = hook;
  }
}
