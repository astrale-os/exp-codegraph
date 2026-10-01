package main

import "testing"

func TestRuntimeBundledValueCoordinateUsesCapturedCallerPackage(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "package.json", `{"name":"@1pact/provenance"}`)
	capture := &governanceCapture{observations: map[string]governanceObservation{}}
	project := &governedProject{Root: root, capture: capture}
	coordinate, err := governanceRuntimeDeclarationCoordinate(project, "bundled:/libs/lib.es5.d.ts")
	if err != nil || coordinate != "package:@1pact/provenance/bundled:/libs/lib.es5.d.ts" {
		t.Fatalf("coordinate=%q err=%v", coordinate, err)
	}
	if valid, err := capture.Verify(); !valid || err != nil {
		t.Fatalf("capture=%v %v", valid, err)
	}
	governanceWrite(t, root, "bundled:/libs/package.json", `{"name":"appeared"}`)
	if valid, _ := capture.Verify(); valid {
		t.Fatal("negative nearest-package observations were not sealed")
	}
}

func TestRuntimeLocalFacadeUsesActualDeclaringCapturedModule(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "mutations/source.ts", `import { identity } from './facade';export const result=identity('q');`)
	governanceWrite(t, root, "mutations/facade.ts", `export { identity } from './helper';`)
	governanceWrite(t, root, "mutations/helper.ts", `export function identity(value:string){return value;}`)
	governanceWrite(t, root, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","moduleResolution":"Bundler","module":"ESNext"},"include":["mutations/**/*.ts"]}`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		t.Fatal(identity.Reason)
	}
	defer project.typeRelease()
	owner := governanceNewRuntimeAuthority(identity)
	result := owner.Resolve("mutations/source.ts", "./facade", "identity")
	if result.Reason != "" || result.Path != "mutations/helper.ts" || result.Origin != nil {
		t.Fatalf("declaring helper=%#v", result)
	}
}

func TestRuntimeMissingCalleeRetainsCanonicalInventoryAbsence(t *testing.T) {
	root := t.TempDir()
	governanceWrite(t, root, "queries/source.ts", `missing();missingAgain();`)
	governanceWrite(t, root, "tsconfig.json", `{"include":["queries/**/*.ts"]}`)
	project, err := captureGovernedProject(root, governanceTestPolicy())
	if err != nil {
		t.Fatal(err)
	}
	governanceSharedProject(project)
	identity := governanceBuildRuntimeIdentity(project)
	if !identity.Complete {
		t.Fatal(identity.Reason)
	}
	defer project.typeRelease()
	owner := governanceNewRuntimeAuthority(identity)
	inventory := owner.Calls([]string{"queries/source.ts"})
	if !inventory.Known || inventory.Complete || len(inventory.Reasons) != 1 || len(inventory.Sites) != 2 {
		t.Fatalf("missing callee inventory=%#v", inventory)
	}
	for _, site := range inventory.Sites {
		if site.Callee != nil {
			t.Fatal("invented relation for unresolved value binding")
		}
	}
}
