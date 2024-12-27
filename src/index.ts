import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as inquirer from 'inquirer';
import * as glob from 'glob';
import { minimatch } from 'minimatch';

// /home/manuelpadilla/sources/reposUbuntu/INNOVATIO/front-end-main

const IGNORED_PATHS = [
    '**/node_modules/**',
    '**/tools/**',
    '**/.turbo/**',
    '**/.vite/**',
    '**/dist/**',
    '**/public/**',
    '**/.next/**',
    '**/.git/**',
    '**/yarn.lock',
    '**/.env.local',
    '**/package-lock.json',
    '**/favicon.ico',
    '**/.gitignore',
    '**/files-contents-config.*.json',
    '**/files-contents.txt',
];

interface IFolder {
    path: string;
    includeSubfolders: boolean;
}

interface IFilterConfig {
    includeFolders: IFolder[];
    excludeFolders: IFolder[];
    fileTypes: string[];
    fileNamePattern?: string; // Add regex filter
}

interface TreeNode {
    [key: string]: TreeNode | null;
}

function getFoldersAtDepth(rootDir: string, maxDepth: number, baseFolder: string = ''): IFolder[] {
    const startDepth = baseFolder ? baseFolder.split(path.sep).filter(Boolean).length : 0;
    const baseFolders = glob
        .sync(baseFolder ? `${baseFolder}/**/` : '**/', {
            cwd: rootDir,
            ignore: IGNORED_PATHS,
        })
        .filter((folder) => {
            const depth = folder.split(path.sep).filter(Boolean).length - startDepth;
            return depth <= maxDepth;
        })
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return baseFolders.flatMap((folder) => {
        const hasSubfolders = glob
            .sync(`${folder}/**/`, {
                cwd: rootDir,
                ignore: IGNORED_PATHS,
            })
            .some((sub) => {
                const subDepth = sub.replace(folder, '').split(path.sep).filter(Boolean).length;
                return subDepth > 0 && subDepth <= maxDepth;
            });

        if (hasSubfolders) {
            return [
                { path: folder, includeSubfolders: false },
                { path: folder, includeSubfolders: true },
            ];
        }
        return [{ path: folder, includeSubfolders: false }];
    });
}

function buildFolderTree(files: string[], rootDir: string): string {
    const tree: TreeNode = {};
    files.forEach((file) => {
        const parts = file.replace(rootDir, '').split(path.sep).filter(Boolean);
        let current = tree;
        parts.forEach((part, index) => {
            if (!current[part]) {
                current[part] = index === parts.length - 1 ? null : {};
            }
            current = current[part] as TreeNode;
        });
    });

    const renderTree = (obj: TreeNode, prefix: string = ''): string => {
        return Object.keys(obj)
            .sort()
            .map((key, index, array) => {
                const isLast = index === array.length - 1;
                const isFile = obj[key] === null;
                const newPrefix = prefix + (isLast ? '└── ' : '├── ');
                const childPrefix = prefix + (isLast ? '    ' : '│   ');

                return newPrefix + key + (isFile ? '' : '\n' + renderTree(obj[key] as TreeNode, childPrefix));
            })
            .join('\n');
    };

    return renderTree(tree);
}

async function getFilteredFiles(
    rootDir: string,
    folders: IFolder[],
    excludeFolders: IFolder[],
    fileNamePattern: string = '',
    selectedTypes: string[] = []
): Promise<string[]> {
    const includedFiles = folders.flatMap((folder) => {
        const pattern = folder.includeSubfolders ? `${folder.path}/**/*` : `${folder.path}/*`;
        return glob.sync(pattern, {
            cwd: rootDir,
            ignore: IGNORED_PATHS,
            dot: true,
            nodir: true,
        });
    });

    const excludePatterns = excludeFolders.map((folder) => {
        return folder.includeSubfolders ? `${folder.path}/**/*` : `${folder.path}/*`;
    });

    const regex = new RegExp(fileNamePattern || '.*');
    return includedFiles
        .filter((file) => {
            const fileNameMatches = regex.test(path.basename(file));
            const fileTypeMatches = selectedTypes.length === 0 || selectedTypes.includes(path.extname(file).toLowerCase());
            const isNotExcluded = !excludePatterns.some((pattern) => minimatch(file, pattern));
            return fileNameMatches && fileTypeMatches && isNotExcluded;
        })
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}


async function getActualFolderList(rootDir: string, selectedFolders: IFolder[], excludedFolders: IFolder[]): Promise<string[]> {
    const allFolders = selectedFolders.flatMap((folder) => {
        if (!folder.includeSubfolders) {
            return [folder.path];
        }

        return glob.sync(`${folder.path}/**/`, {
            cwd: rootDir,
            ignore: IGNORED_PATHS,
        });
    });

    const uniqueFolders = Array.from(new Set(allFolders)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return uniqueFolders.filter(
        (folder) =>
            !excludedFolders.some((excluded) => {
                if (excluded.includeSubfolders) {
                    return folder.startsWith(excluded.path);
                }
                return folder === excluded.path;
            })
    );
}

async function main() {
    const { rootDir } = await inquirer.prompt([
        {
            type: 'input',
            name: 'rootDir',
            message: 'Root directory:',
            default: process.cwd(), // '/home/manuelpadilla/sources/reposUbuntu/INNOVATIO/front-end-main',
        },
    ]);

    const filterFiles = glob.sync('files-contents-config.*.json', { maxDepth: 3 });
    let config: IFilterConfig = {
        includeFolders: [],
        excludeFolders: [],
        fileTypes: [],
    };

    if (filterFiles.length > 0) {
        const { useFilter } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'useFilter',
                message: 'Use existing filter?',
            },
        ]);

        if (useFilter) {
            const { filterFile } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'filterFile',
                    choices: filterFiles,
                },
            ]);
            config = await fs.readJson(filterFile);
        }
    }

    const { depth } = await inquirer.prompt([
        {
            type: 'number',
            name: 'depth',
            message: 'Folder depth to display:',
            default: 3,
        },
    ]);

    const folderChoices = getFoldersAtDepth(rootDir, depth);
    const { selectedFolders }: { selectedFolders: IFolder[] } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selectedFolders',
            message: 'Select folders to include:',
            choices: folderChoices
                .map((folder) => ({
                    name: folder.includeSubfolders ? `${folder.path} [+Subfolders]` : folder.path,
                    value: folder,
                }))
                .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
            default: folderChoices
                .filter((folder) => config.includeFolders.some((f) => f.path === folder.path && f.includeSubfolders === folder.includeSubfolders))
                .map((folder) => folder), // Return the actual folder object instead of string
        },
    ]);

    const removeChoices: IFolder[] = Array.from(
        new Set(
            (selectedFolders as IFolder[])
                .flatMap((folder: IFolder) => {
                    if (!folder.includeSubfolders) return [folder];

                    const subfolders = getFoldersAtDepth(rootDir, depth, folder.path);
                    return [folder, ...subfolders];
                })
                .map((f) => JSON.stringify(f))
        )
    )
        .map((f) => JSON.parse(f))
        .sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));

    const { excludedFolders }: { excludedFolders: IFolder[] } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'excludedFolders',
            message: 'Select folders to exclude:',
            choices: removeChoices
                .map((folder) => ({
                    name: folder.includeSubfolders ? `${folder.path} [+Subfolders]` : folder.path,
                    value: folder,
                }))
                .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
            default: removeChoices
                .filter((folder) => config.excludeFolders.some((f) => f.path === folder.path && f.includeSubfolders === folder.includeSubfolders))
                .map((folder) => folder), // Return the actual folder object instead of string
        },
    ]);

    // Show summary of selected folders
    const actualFolders = await getActualFolderList(rootDir, selectedFolders, excludedFolders);

    console.log('\nFolders to be processed:');
    actualFolders.forEach((folder) => {
        console.log(chalk.blue(`• ${folder}`));
    });

    const totalFolders = actualFolders.length;
    console.log(chalk.yellow(`\nTotal folders to process: ${totalFolders}`));

    const { continueProcess } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'continueProcess',
            message: 'Continue with these folders?',
            default: true,
        },
    ]);

    if (!continueProcess) {
        console.log(chalk.yellow('Process cancelled'));
        return;
    }

    const files = await getFilteredFiles(rootDir, selectedFolders, excludedFolders);
    const fileTypes = Array.from(new Set(files.map((file) => path.extname(file).toLowerCase())))
        .filter(Boolean)
        .sort();

    const { selectedTypes } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selectedTypes',
            message: 'Select file types:',
            choices: fileTypes,
            default: config.fileTypes,
        },
    ]);

    const { fileNamePattern } = await inquirer.prompt([
        {
            type: 'input',
            name: 'fileNamePattern',
            message: 'Enter a regex pattern for file names (e.g., ".*\\.txt"):',
            default: config.fileNamePattern || '',
        },
    ]);

    const { saveConfig } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'saveConfig',
            message: 'Save configuration?',
            default: true,
        },
    ]);

    if (saveConfig) {
        const { configName } = await inquirer.prompt([
            {
                type: 'input',
                name: 'configName',
                message: 'Configuration name:',
                default: 'CUSTOM',
            },
        ]);

        const { configPath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'configPath',
                message: 'Config path:',
                default: rootDir,
            },
        ]);

        const newConfig: IFilterConfig = {
            includeFolders: selectedFolders,
            excludeFolders: excludedFolders,
            fileTypes: selectedTypes,
            fileNamePattern: fileNamePattern,
        };

        const finalConfigFile = path.join(configPath, `files-contents-config.${configName}.json`);
        await fs.writeJson(finalConfigFile, newConfig, { spaces: 2 });
        console.log(chalk.green(`Configuration saved to ${finalConfigFile}`));
    }

    const finalFiles = await getFilteredFiles(rootDir, selectedFolders, excludedFolders, fileNamePattern, selectedTypes);

    console.log('\nFiltered files:');
    const folderTree = buildFolderTree(finalFiles, rootDir);
    console.log(folderTree);

    const { exportContent } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'exportContent',
            message: 'Export file contents?',
        },
    ]);

    if (exportContent) {
        const { exportPath } = await inquirer.prompt([
            {
                type: 'input',
                name: 'exportPath',
                message: 'Export file path:',
                default: path.join(rootDir, 'files-contents.txt'),
            },
        ]);
        const output = fs.createWriteStream(exportPath);

        const { includeFolderTree } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'includeFolderTree',
                message: 'Include folder tree in export?',
                default: true,
            },
        ]);

        if (includeFolderTree) {
            output.write('====== Folder Tree ======\n\n');
            output.write(folderTree);
            output.write('\n\n');
        }

        output.write('====== File contents ======\n\n');
        for (const file of finalFiles) {
            const fullPath = path.join(rootDir, file);
            output.write(`\n====== ${file} ======\n\n`);
            output.write(await fs.readFile(fullPath, 'utf8'));
        }
        output.end();

        console.log(chalk.green(`File contents exported to ${exportPath}`));
    }
}

main().catch((error) => {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
});
