package observabledecision

func sdkDefinitionFile(file, kind string) bool {
	for _, root := range []string{"src", "dist"} {
		for _, extension := range []string{"ts", "d.ts"} {
			if file == root+"/application/"+kind+"/define."+extension {
				return true
			}
		}
	}
	return false
}
func (r *demandRun) modelQueryReceiver(receiver demandValue, name string) (demandValue, bool) {
	model := func(value demandValue) (demandValue, bool) {
		if value.kind == "query-namespace" && name == "from" {
			return demandKnown("builder", ""), true
		}
		if value.kind == "builder" && name != "from" {
			if name == "select" {
				return demandKnown("request", ""), true
			}
			return demandKnown("builder", ""), true
		}
		if value.kind == "external" || value.kind == "query-namespace" {
			reason := "external query builder provenance is unavailable"
			if name == "from" {
				reason = "external Query factory value has no canonical declaration provenance"
			}
			return demandValue{kind: "unknown", reason: "VALUE_MODEL_UNKNOWN", text: reason}, true
		}
		return demandValue{}, false
	}
	if receiver.kind == "unknown" || receiver.kind == "unsupported" {
		return demandValue{kind: "unknown", reason: "VALUE_MODEL_UNKNOWN", text: "query receiver has unresolved value provenance"}, true
	}
	if receiver.kind == "alternatives" {
		var known *demandValue
		for _, value := range receiver.values {
			modeled, ok := model(value)
			if !ok || modeled.kind == "unknown" {
				return demandValue{kind: "unknown", reason: "VALUE_MODEL_UNKNOWN", text: "query receiver has unresolved value provenance"}, true
			}
			if known == nil {
				copy := modeled
				known = &copy
			} else if known.kind != modeled.kind || known.text != modeled.text {
				return demandValue{kind: "unknown", reason: "VALUE_MODEL_UNKNOWN", text: "query receiver has unresolved value provenance"}, true
			}
		}
		if known != nil {
			return *known, true
		}
	}
	return model(receiver)
}
