package main

import "astrale-typespec-v2-native-analysis/authoredsource"

func (file *governedFile) authoring() *authoredsource.File {
	if file.authored == nil {
		file.authored = authoredsource.New(file.Source)
	}
	return file.authored
}
