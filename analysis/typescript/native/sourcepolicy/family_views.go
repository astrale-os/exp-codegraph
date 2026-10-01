package sourcepolicy

import authored "astrale-typespec-v2-native-analysis/authoredsource"

func EvaluateViews(project *Project) Result {
	out := familyResult()
	for _, file := range familyProduction(project, "views") {
		for _, name := range []string{"defineSchema", "defineClass", "edgeClass", "func", "nodeClass", "policy", "property", "view"} {
			for _, definition := range project.Authored(file).Definitions(name, "", authored.DSLModules, 0) {
				if familyOrigin(&out, "VIW-SCHEMA-DECL", file, definition, name+" declaration") {
					continue
				}
				familyEmit(&out, "VIW-SCHEMA-DECL", file, definition.Call, "violation", "Views declares DSL construct "+name+"; Schema owns it.")
			}
		}
	}
	for _, file := range familyProduction(project, "views") {
		for _, definition := range project.Authored(file).Definitions("defineFrontend", "", []string{"@astrale-os/sdk", "@astrale-os/sdk/application", "@astrale-os/sdk/view"}, 0) {
			if familyOrigin(&out, "VIW-NO-COMPOSE", file, definition, "defineFrontend composition") {
				continue
			}
			familyEmit(&out, "VIW-NO-COMPOSE", file, definition.Call, "violation", "Views composes an SDK frontend; move defineFrontend beside defineApplication in application.ts.")
		}
	}
	return out
}
