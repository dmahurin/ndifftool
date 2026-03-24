let files = [];
let editorInstance = null;
let currentLayout = 2;
window.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
        console.error('Initialization failed:', err);
        const info = document.getElementById('file-info');
        if (info) info.innerHTML = `<span style="color: red;">Init Error: ${err.message}</span>`;
    });
});

async function init() {
    console.log('Window location:', window.location.href);
    if (typeof Neutralino === 'undefined') {
        throw new Error('Neutralino client library not loaded');
    }
    if (typeof CodeMirror === 'undefined') {
        throw new Error('CodeMirror library not loaded');
    }

    Neutralino.init();
    Neutralino.events.on("windowClose", () => Neutralino.app.exit());

    // Debug: Log NL_ARGS to console
    console.log('NL_ARGS:', NL_ARGS);

    let args = [];
    const dashDashIndex = NL_ARGS.indexOf('--');
    if (dashDashIndex !== -1) {
        args = NL_ARGS.slice(dashDashIndex + 1);
    } else {
        args = NL_ARGS.slice(1).filter(arg => !arg.startsWith('--'));
    }
    
    console.log('Parsed args:', args);

    if (args.length > 0) {
        for (let path of args) {
            try {
                let content = await Neutralino.filesystem.readFile(path);
                files.push({ path, content });
                console.log(`Loaded: ${path} (${content.length} chars)`);
            } catch (err) {
                console.error(`Error reading file ${path}:`, err);
                // Attempt absolute path if relative fails
                try {
                   // Some Neutralino environments need paths relative to binary or absolute
                   // Try to get current directory or just log it
                   console.log(`Trying again for ${path}...`);
                } catch (e) {}
            }
        }
    }

    // Determine layout
    if (files.length >= 4) currentLayout = 4;
    else if (files.length === 3) currentLayout = 3;
    else currentLayout = 2; // Covers 0, 1, 2 files

    setLayout(currentLayout);
    updateFileInfo();
    
    if (files.length === 0 && args.length > 0) {
        const info = document.getElementById('file-info');
        info.innerHTML = `<span style="color: red;">Failed to load any files from args: ${args.join(', ')}</span>`;
    }
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
        options.origLeft = files[0]?.content || '';
        options.value = files[1]?.content || '';
        options.orig = files[2]?.content || '';
    }

    editorInstance = CodeMirror.MergeView(container, options);
}

function initFourColumnView() {
    const container = document.getElementById('editor-container');
    const layout = document.createElement('div');
    layout.className = 'four-column-layout';
    container.appendChild(layout);

    const editors = [];
    const labels = ['BASE', 'LOCAL', 'REMOTE', 'MERGE RESULT'];

    const mode = getMode(files[0]?.path);
    for (let i = 0; i < 4; i++) {
        const pane = document.createElement('div');
        const label = document.createElement('div');
        label.className = 'pane-label';
        label.innerText = labels[i];
        pane.appendChild(label);
        layout.appendChild(pane);

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
        getEditor: () => editors[3],
        type: 'four'
    };
}

function updateFileInfo() {
    const info = document.getElementById('file-info');
    if (files.length === 0) {
        info.innerText = 'No files loaded. Use: neu run -- file1 file2 ...';
    } else {
        info.innerText = `Loaded ${files.length} file(s): ` + files.map(f => f.path.split('/').pop()).join(' vs ');
    }
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
