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
    if (typeof Neutralino === 'undefined') {
        throw new Error('Neutralino client library not loaded');
    }
    if (typeof CodeMirror === 'undefined') {
        throw new Error('CodeMirror library not loaded');
    }
    if (typeof diff_match_patch === 'undefined') {
        throw new Error('diff_match_patch library not loaded');
    }

    Neutralino.init();
    Neutralino.events.on("windowClose", () => Neutralino.app.exit());

    // Strict CLI argument parsing
    let args = [];
    const dashDashIndex = NL_ARGS.indexOf('--');
    if (dashDashIndex !== -1) {
        args = NL_ARGS.slice(dashDashIndex + 1);
    } else {
        // Filter out binary, internal flags, and macOS PSN arguments
        args = NL_ARGS.slice(1).filter(arg => !arg.startsWith('-'));
    }
    
    // Clear state
    files = [];

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

    // Determine layout automatically
    if (files.length >= 4) currentLayout = 4;
    else if (files.length === 3) currentLayout = 3;
    else currentLayout = 2;

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
    container.innerHTML = ''; 

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
        theme: 'monokai',
        allowEditingOriginals: true,
        revertButtons: true
    };

    if (cols === 2) {
        options.value = files[0]?.content || '';
        options.orig = files[1]?.content || '';
    } else {
        options.origLeft = files[0]?.content || '';
        options.value = files[1]?.content || '';
        options.orig = files[2]?.content || '';
    }

    editorInstance = CodeMirror.MergeView(container, options);
    
    // Sync file content on all changes
    [editorInstance.edit, editorInstance.left?.orig, editorInstance.right?.orig].forEach((cm, i) => {
        if (!cm) return;
        cm.on('change', () => {
            // Mapping depends on layout. This is a simplified approach.
            // In 2-way: edit is files[0], right.orig is files[1].
            // In 3-way: left.orig is files[0], edit is files[1], right.orig is files[2].
            if (cols === 2) {
                if (cm === editorInstance.edit) files[0].content = cm.getValue();
                else files[1].content = cm.getValue();
            } else {
                if (cm === editorInstance.left.orig) files[0].content = cm.getValue();
                else if (cm === editorInstance.edit) files[1].content = cm.getValue();
                else files[2].content = cm.getValue();
            }
        });
    });

    // Custom UI for merge buttons
    const updateButtons = () => {
        // Left gutter (between Left and Center)
        if (editorInstance.left) {
            customizeGutter(editorInstance.left, 'left');
        }
        // Right gutter (between Center and Right)
        if (editorInstance.right) {
            customizeGutter(editorInstance.right, 'right');
        }
    };

    editorInstance.edit.on('update', updateButtons);
    setTimeout(updateButtons, 50); // Initial
}

function customizeGutter(diffView, side) {
    const gutter = diffView.gutter;
    if (!gutter) return;

    const buttons = gutter.querySelectorAll('.CodeMirror-merge-copy:not(.customized)');
    buttons.forEach(btn => {
        btn.classList.add('customized');
        btn.removeAttribute('title');
        
        // Pull Icon (from orig to edit)
        btn.innerHTML = (side === 'left') ? '→' : '←';
        
        // Add Push Button (from edit to orig)
        const pushBtn = document.createElement('div');
        pushBtn.className = 'CodeMirror-merge-copy CodeMirror-merge-copy-push';
        pushBtn.innerHTML = (side === 'left') ? '←' : '→';
        btn.parentNode.appendChild(pushBtn);

        pushBtn.onclick = (e) => {
            e.stopPropagation();
            // We need to find the chunk this button belongs to
            const top = parseInt(btn.style.top);
            const chunk = diffView.chunks.find(c => {
                const line = diffView.edit.lineAtHeight(top, 'local');
                return c.editFrom <= line && c.editTo >= line;
            });

            if (chunk) {
                const edit = diffView.edit;
                const orig = diffView.orig;
                const text = edit.getRange({line: chunk.editFrom, ch: 0}, {line: chunk.editTo, ch: 0});
                orig.replaceRange(text, {line: chunk.origFrom, ch: 0}, {line: chunk.origTo, ch: 0});
            }
        };
    });
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
        
        cm.on('change', () => {
            if (files[i]) files[i].content = cm.getValue();
        });

        editors.push(cm);
    }

    // Highlighting differences in 4-column mode
    const dmp = new diff_match_patch();
    
    function highlightDiff(editor, baseText, currentText) {
        if (!baseText || !currentText) return;
        const diffs = dmp.diff_main(baseText, currentText);
        dmp.diff_cleanupSemantic(diffs);
        
        let pos = 0;
        diffs.forEach(([op, text]) => {
            if (op === 0) { // EQUAL
                pos += text.length;
            } else if (op === 1) { // INSERT
                const start = editor.posFromIndex(pos);
                pos += text.length;
                const end = editor.posFromIndex(pos);
                editor.markText(start, end, { className: 'cm-merge-r-inserted' });
            } else if (op === -1) { // DELETE
                const start = editor.posFromIndex(pos);
                const end = editor.posFromIndex(pos + 1);
                editor.markText(start, end, { className: 'cm-merge-r-deleted' });
            }
        });
    }

    if (files.length >= 3) {
        const baseText = files[0].content;
        highlightDiff(editors[1], baseText, files[1].content); // Local
        highlightDiff(editors[2], baseText, files[2].content); // Remote
        if (files[3]) highlightDiff(editors[3], baseText, files[3].content); // Merge Result
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
