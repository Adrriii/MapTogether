import simpleImportSort from 'eslint-plugin-simple-import-sort';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	...tseslint.configs.strict,
	...tseslint.configs.stylistic,
	{
		plugins: {
			sonarjs,
			'simple-import-sort': simpleImportSort,
		},
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'no-restricted-imports': ['error', { patterns: ['./*', '../*'] }],
			'indent': ['error', 'tab', { SwitchCase: 1 }],
			'sonarjs/cognitive-complexity': ['error', 12],
			'max-lines': ['error', {
				max: 300,
				skipBlankLines: true,
				skipComments: true,
			}],
			'@typescript-eslint/consistent-type-definitions': ['error', 'type'],
			'simple-import-sort/imports': ['error', {
				groups: [
					['^\\u0000'],
					['^node:'],
					['^(?!@(mtg-|lib/|quaver-ipc/))@?\\w'],
					['@lib'],
					['@quaver-ipc'],
					['@mtg-shared'],
					['@mtg-companion'],
					['@mtg-server'],
				],
			}],
			'simple-import-sort/exports': 'error',
			'no-mixed-spaces-and-tabs': 'error',
			'max-statements-per-line': ['error', { max: 2 }],
			'object-curly-spacing': ['error', 'always'],
			'object-curly-newline': ['error', { multiline: true }],
			'object-property-newline': ['error', { allowAllPropertiesOnSameLine: false }],
			'key-spacing': ['error', { afterColon: true }],
			'comma-dangle': ['error', 'always-multiline'],
			'@typescript-eslint/switch-exhaustiveness-check': 'error',
		},
	},
);
