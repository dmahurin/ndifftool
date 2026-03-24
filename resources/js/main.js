let files = [];
let editorInstance = null;
let currentLayout = 2;

async function init() {
    Neutralino.init();
    Neutralino.events.on("windowClose", () => Neutralino.app.exit());

    // Parse CLI arguments
    // NL_ARGS contains [binary, --res-mode, ..., --, file1, file2, ...]
    // But Neutralino sometimes passes arguments differently.
    // Let's filter out internal arguments.
    let args = NL_ARGS.slice(1).filter(arg => !arg.startsWith('--'));
    
    // If '--' is present, args after it are user args
    const dashDashIndex = NL_ARGS.indexOf('--');
    if (dashDashIndex !== -1) {
        args = NL_ARGS.slice(dashDashIndex + 1);
    }

    if (args.length > 0) {
        for (let path of args) {
            try {
                let content = await Neutralino.filesystem.readFile(path);
                files.push({ path, content });
            } catch (err) {
                console.error(`Error reading file ${path}:`, err);
            }
        }
    }

    // Default layout based on number of files
    if (files.length >= 4) currentLayout = 4;
    else if (files.length === 3) currentLayout = 3;
    else currentLayout = 2;

    setLayout(currentLayout);
    updateFileInfo();
}

function setLayout(cols) {
    currentLayout = cols;
    const container = document.getElementById('editor-container');
    container.innerHTML = ''; // Clear previous

    if (cols === 2 || cols === 3) {
        initMergeView(cols);
    } else if (cols === 4) {
        initFourColumnView();
    }
}

function getMode(path) {
    if (!path) return 'javascript';
    const ext = path.split('.').pop().toLowerCase();
    const modes = {
        'js': 'javascript',
        'ts': 'javascript',
        'html': 'htmlmixed',
        'css': 'css',
        'py': 'python',
        'md': 'markdown',
        'json': 'javascript',
        'xml': 'xml'
    };
    return modes[ext] || 'javascript';
}

function initMergeView(cols) {
    const container = document.getElementById('editor-container');
    const mode = getMode(files[0]?.path);
    const options = {
        lineNumbers: true,
        mode: mode,
        highlightDifferences: true,
        connect: 'align',
        collapseIdentical: false,
        theme: 'monokai'
    };

    if (cols === 2) {
        options.value = files[0]?.content || '';
        options.orig = files[1]?.content || '';
    } else {
        // 3-way merge: Left, Middle (Result), Right
        // Often: Local, Base, Remote
        options.origLeft = files[0]?.content || '';
        options.value = files[1]?.content || '';
        options.orig = files[2]?.content || '';
    }

    editorInstance = CodeMirror.MergeView(container, options);
}

function initFourColumnView() {
    const container = document.getElementById('editor-container');
    const grid = document.createElement('div');
    grid.className = 'four-column-grid';
    container.appendChild(grid);

    const editors = [];
    const labels = ['BASE', 'LOCAL', 'REMOTE', 'MERGE RESULT'];

    const mode = getMode(files[0]?.path);
    for (let i = 0; i < 4; i++) {
        const pane = document.createElement('div');
        const label = document.createElement('div');
        label.className = 'pane-label';
        label.innerText = labels[i];
        pane.appendChild(label);
        grid.appendChild(pane);

        const cm = CodeMirror(pane, {
            value: files[i]?.content || '',
            lineNumbers: true,
            mode: mode,
            theme: 'monokai',
            readOnly: i < 3 ? 'nocursor' : false
        });
        editors.push(cm);
    }

    // Sync scrolling
    editors.forEach((cm, index) => {
        cm.on('scroll', (instance) => {
            const info = instance.getScrollInfo();
            editors.forEach((other, otherIndex) => {
                if (index !== otherIndex) {
                    other.scrollTo(info.left, info.top);
                }
            });
        });
    });

    editorInstance = {
        getEditor: () => editors[3], // The editable one
        type: 'four'
    };
}

function updateFileInfo() {
    const info = document.getElementById('file-info');
    info.innerText = files.map(f => f.path.split('/').pop()).join(' vs ');
}

async function saveResult() {
    let result = '';
    if (currentLayout === 2 || currentLayout === 3) {
        result = editorInstance.edit.getValue();
    } else if (currentLayout === 4) {
        result = editorInstance.getEditor().getValue();
    }

    // Determine where to save. If 3-way or 4-way, usually the 2nd or 4th file.
    // For now, let's ask where to save or use a default.
    try {
        let savePath = await Neutralino.os.showSaveDialog('Save Merge Result');
        if (savePath) {
            await Neutralino.filesystem.writeFile(savePath, result);
            Neutralino.os.showMessageBox('Success', `Result saved to ${savePath}`);
        }
    } catch (err) {
        console.error('Save failed:', err);
    }
}

init();
