let files = [];
let editorInstance = null;
let currentLayout = 2;
let activeCM = null; 
let isEditMode = false;
let allEditors = []; 
let columnChunks = []; // Stored chunks for 4-column mode: [null, localChunks, remoteChunks, mergeChunks]

window.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
        console.error('Initialization failed:', err);
        const info = document.getElementById('file-info');
        if (info) info.innerHTML = `<span style="color: red;">Init Error: ${err.message}</span>`;
    });
});

async function init() {
    if (typeof Neutralino === 'undefined') throw new Error('Neutralino library not loaded');
    if (typeof CodeMirror === 'undefined') throw new Error('CodeMirror library not loaded');
    if (typeof diff_match_patch === 'undefined') throw new Error('diff_match_patch library not loaded');

    Neutralino.init();
    Neutralino.events.on("windowClose", () => Neutralino.app.exit());

    let args = [];
    const dashDashIndex = NL_ARGS.indexOf('--');
    if (dashDashIndex !== -1) {
        args = NL_ARGS.slice(dashDashIndex + 1);
    } else {
        args = NL_ARGS.slice(1).filter(arg => !arg.startsWith('-'));
    }
    
    files = [];
    if (args.length > 0) {
        for (let path of args) {
            try {
                let content = await Neutralino.filesystem.readFile(path);
                files.push({ path, content });
            } catch (err) {
                console.error(`Error reading ${path}:`, err);
            }
        }
    }

    if (files.length >= 4) currentLayout = 4;
    else if (files.length === 3) currentLayout = 3;
    else currentLayout = 2;

    setLayout(currentLayout);
    updateFileInfo();
    setMode(false); 
}

function setMode(edit) {
    isEditMode = edit;
    document.body.classList.toggle('line-select-mode', !edit);
    
    // Ensure we have an active editor to focus
    if (allEditors.length > 0 && !activeCM) {
        activeCM = allEditors[0];
        activeCM.getWrapperElement().classList.add('editor-active');
    }

    allEditors.forEach(cm => {
        cm.setOption('readOnly', !edit);
        cm.setOption('cursorBlinkRate', edit ? 530 : -1);
        
        if (!edit) {
            // Exiting Edit Mode: Expand existing selection to full lines
            const from = cm.getCursor('from');
            const to = cm.getCursor('to');
            if (from.line !== to.line || from.ch !== to.ch) {
                cm.setSelection(
                    {line: Math.max(from.line, to.line), ch: cm.getLine(Math.max(from.line, to.line)).length},
                    {line: Math.min(from.line, to.line), ch: 0},
                    {scroll: false}
                );
            } else {
                cm.setCursor({line: from.line, ch: 0});
            }
        } else if (cm === activeCM) {
            // Entering Edit Mode: Clear selection and put cursor at start of last selected line
            const to = cm.getCursor('to');
            cm.setSelection({line: to.line, ch: 0}, {line: to.line, ch: 0}, {scroll: true});
        }
        // Force re-render to show/hide cursor immediately
        cm.refresh();
    });

    if (edit && activeCM) {
        activeCM.focus();
    }
    
    updateFileInfo();
}

function handleKey(cm, e) {
    if (e.keyCode === 13 && !isEditMode) { // Enter
        e.preventDefault();
        setMode(true);
    } else if (e.keyCode === 27 && isEditMode) { // Escape
        e.preventDefault();
        setMode(false);
    }
}
function clearOtherSelections(currentCM) {
    allEditors.forEach(cm => {
        if (cm !== currentCM) {
            // Clear selection by setting head to anchor with a custom origin
            const cur = cm.getCursor();
            cm.setSelection(cur, cur, {origin: 'clearSelection', scroll: false});
            cm.getWrapperElement().classList.remove('editor-active');
        }
    });
    currentCM.getWrapperElement().classList.add('editor-active');
    activeCM = currentCM;
}

function setupEditor(cm, index) {
    allEditors.push(cm);

    cm.on('focus', () => clearOtherSelections(cm));
    cm.on('mousedown', () => clearOtherSelections(cm));
    cm.on('keydown', handleKey);

    cm.on('beforeSelectionChange', (cm, obj) => {
        if (obj.origin && obj.origin !== 'setValue' && obj.origin !== 'clearSelection') {
            const hasSelection = obj.ranges.some(r => r.anchor.line !== r.head.line || r.anchor.ch !== r.head.ch);
            if (hasSelection) clearOtherSelections(cm);
        }

        if (!isEditMode && obj.ranges && obj.origin !== 'setValue' && obj.origin !== 'clearSelection') {
            obj.ranges.forEach(range => {
                const startLine = Math.min(range.anchor.line, range.head.line);
                const endLine = Math.max(range.anchor.line, range.head.line);
                
                if (range.head.line <= range.anchor.line) {
                    // Clicking or dragging UP: keep head at the top
                    range.anchor = {line: endLine, ch: cm.getLine(endLine).length};
                    range.head = {line: startLine, ch: 0};
                } else {
                    // Dragging DOWN: keep head at the bottom to allow drag to continue
                    range.anchor = {line: startLine, ch: 0};
                    range.head = {line: endLine, ch: cm.getLine(endLine).length};
                }
            });
        }
    });

    cm.on('cursorActivity', () => {
        if (!isEditMode && activeCM === cm) {
            // Keep the top of the selection in view
            cm.scrollIntoView(cm.getCursor('from'));
        }
    });

    cm.on('change', () => {
        if (files[index]) files[index].content = cm.getValue();
        if (currentLayout === 4) refreshFourColumnChunks();
    });
}

// Global mouseup to reverse selections after dragging
window.addEventListener('mouseup', () => {
    if (!isEditMode && activeCM) {
        const from = activeCM.getCursor('from');
        const to = activeCM.getCursor('to');
        // Always force head to start of top line (reversed selection)
        activeCM.setSelection(
            {line: to.line, ch: activeCM.getLine(to.line).length},
            {line: from.line, ch: 0},
            {scroll: false}
        );
        // Ensure the top line is visible
        activeCM.scrollIntoView({line: from.line, ch: 0});
    }
});

function setLayout(cols) {
    currentLayout = cols;
    allEditors = [];
    columnChunks = [];
    const container = document.getElementById('editor-container');
    container.innerHTML = ''; 

    if (cols === 2 || cols === 3) initMergeView(cols);
    else if (cols === 4) initFourColumnView();
}

function initMergeView(cols) {
    const container = document.getElementById('editor-container');
    const mode = getMode(files[0]?.path);
    const options = {
        lineNumbers: true, mode: mode,
        highlightDifferences: true, connect: 'align',
        collapseIdentical: false, theme: 'monokai',
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
    
    if (cols === 2) {
        setupEditor(editorInstance.edit, 0);
        setupEditor(editorInstance.right.orig, 1);
    } else {
        setupEditor(editorInstance.left.orig, 0);
        setupEditor(editorInstance.edit, 1);
        setupEditor(editorInstance.right.orig, 2);
    }
}

function getLineChunks(text1, text2) {
    const dmp = new diff_match_patch();
    const a = dmp.diff_linesToChars_(text1, text2);
    const lineDiffs = dmp.diff_main(a.chars1, a.chars2, false);
    dmp.diff_charsToLines_(lineDiffs, a.lineArray);
    
    let chunks = [];
    let line1 = 0, line2 = 0;
    
    lineDiffs.forEach(([op, text]) => {
        const count = text.split('\n').length - 1;
        if (op === 0) { // EQUAL
            line1 += count;
            line2 += count;
        } else if (op === -1) { // DELETE (in text1)
            let chunk = {origFrom: line1, origTo: line1 + count, editFrom: line2, editTo: line2};
            chunks.push(chunk);
            line1 += count;
        } else if (op === 1) { // INSERT (in text2)
            // Check if last chunk was a delete to merge into a change
            if (chunks.length > 0 && chunks[chunks.length - 1].editFrom === line2 && chunks[chunks.length - 1].editTo === line2) {
                chunks[chunks.length - 1].editTo = line2 + count;
            } else {
                chunks.push({origFrom: line1, origTo: line1, editFrom: line2, editTo: line2 + count});
            }
            line2 += count;
        }
    });
    return chunks;
}

function refreshFourColumnChunks() {
    if (files.length < 2) return;
    const base = files[0].content;
    columnChunks = [null];
    for (let i = 1; i < 4; i++) {
        if (files[i]) columnChunks[i] = getLineChunks(base, files[i].content);
        else columnChunks[i] = [];
    }
}

function initFourColumnView() {
    const container = document.getElementById('editor-container');
    const layout = document.createElement('div');
    layout.className = 'four-column-layout';
    container.appendChild(layout);

    const labels = ['BASE', 'LOCAL', 'REMOTE', 'MERGE'];
    const mode = getMode(files[0]?.path);

    for (let i = 0; i < 4; i++) {
        const pane = document.createElement('div');
        const label = document.createElement('div');
        label.className = 'pane-label'; label.innerText = labels[i];
        pane.appendChild(label); layout.appendChild(pane);

        const cm = CodeMirror(pane, {
            value: files[i]?.content || '',
            lineNumbers: true, mode: mode, theme: 'monokai'
        });
        setupEditor(cm, i);
    }
    refreshFourColumnChunks();

    allEditors.forEach((cm, index) => {
        cm.on('scroll', (instance) => {
            const info = instance.getScrollInfo();
            allEditors.forEach((other, otherIndex) => {
                if (index !== otherIndex) other.scrollTo(info.left, info.top);
            });
        });
    });
}

function mapLine(chunks, line, fromOrig) {
    if (!chunks || chunks.length === 0) return line;
    for (let c of chunks) {
        if (fromOrig) {
            if (line < c.origFrom) return line + (c.editFrom - c.origFrom);
            if (line < c.origTo) return c.editFrom; 
        } else {
            if (line < c.editFrom) return line + (c.origFrom - c.editFrom);
            if (line < c.editTo) return c.origFrom;
        }
    }
    const last = chunks[chunks.length - 1];
    return fromOrig ? line + (last.editTo - last.origTo) : line + (last.origTo - last.editTo);
}

function moveSelectedLines(direction) {
    if (!activeCM) return;

    // Issue 3: If in Edit Mode, switch back to Select Mode first
    if (isEditMode) {
        setMode(false);
    }
    
    const currentIndex = allEditors.indexOf(activeCM);
    let targetIndex = (direction === 'left') ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= allEditors.length) return;
    
    const targetCM = allEditors[targetIndex];
    const from = activeCM.getCursor('from');
    const to = activeCM.getCursor('to');

    let sourceStart = from.line, sourceEnd = to.line;
    let targetStart, targetEnd;

    if (currentLayout === 4) {
        // Mapping in 4-column: Source -> BASE -> Target
        // BASE is index 0.
        let baseStart = (currentIndex === 0) ? sourceStart : mapLine(columnChunks[currentIndex], sourceStart, false);
        let baseEnd = (currentIndex === 0) ? sourceEnd : mapLine(columnChunks[currentIndex], sourceEnd, false);
        
        targetStart = (targetIndex === 0) ? baseStart : mapLine(columnChunks[targetIndex], baseStart, true);
        targetEnd = (targetIndex === 0) ? baseEnd : mapLine(columnChunks[targetIndex], baseEnd, true);
    } else {
        // MergeView mapping
        const diffView = (currentIndex === 0 || (currentLayout === 3 && currentIndex === 1)) ? editorInstance.left : editorInstance.right;
        const fromOrig = (currentIndex === 0 || (currentLayout === 3 && currentIndex === 2));
        
        // If moving from side to center or center to side
        if (currentLayout === 2) {
            targetStart = mapLine(editorInstance.right.chunks, sourceStart, fromOrig);
            targetEnd = mapLine(editorInstance.right.chunks, sourceEnd, fromOrig);
        } else {
            // 3-way is more complex, simplify to using visual if logical mapping logic becomes too deep
            // But let's try logical first for the active diff view
            const dv = (currentIndex === 0) ? editorInstance.left : (currentIndex === 2) ? editorInstance.right : null;
            if (dv) {
                targetStart = mapLine(dv.chunks, sourceStart, true);
                targetEnd = mapLine(dv.chunks, sourceEnd, true);
            } else {
                // Moving from center (index 1) to left (0) or right (2)
                const dvTarget = (targetIndex === 0) ? editorInstance.left : editorInstance.right;
                targetStart = mapLine(dvTarget.chunks, sourceStart, false);
                targetEnd = mapLine(dvTarget.chunks, sourceEnd, false);
            }
        }
    }

    const text = activeCM.getRange({line: sourceStart, ch: 0}, {line: sourceEnd, ch: activeCM.getLine(sourceEnd).length});
    targetCM.replaceRange(text, {line: targetStart, ch: 0}, {line: targetEnd, ch: targetCM.getLine(targetEnd).length});
    
    const newEndLine = targetStart + (sourceEnd - sourceStart);
    // Reverse selection: anchor at bottom, head at top (ch 0)
    targetCM.setSelection(
        {line: newEndLine, ch: targetCM.getLine(newEndLine).length},
        {line: targetStart, ch: 0}
    );
    clearOtherSelections(targetCM);
    targetCM.focus();
}

function getMode(path) {
    if (!path) return 'javascript';
    const ext = path.split('.').pop().toLowerCase();
    const modes = {'js':'javascript','ts':'javascript','html':'htmlmixed','css':'css','py':'python','md':'markdown','json':'javascript','xml':'xml'};
    return modes[ext] || 'javascript';
}

function updateFileInfo() {
    const info = document.getElementById('file-info');
    const modeLabel = isEditMode ? '<span class="mode-indicator mode-indicator-edit">EDIT</span>' : '<span class="mode-indicator">SELECT</span>';
    if (files.length === 0) info.innerHTML = `${modeLabel} No files loaded.`;
    else info.innerHTML = `${modeLabel} Loaded ${files.length} file(s): ` + files.map(f => f.path.split('/').pop()).join(' vs ');
}

async function saveResult() {
    let result = (currentLayout === 4) ? allEditors[3].getValue() : editorInstance.edit.getValue();
    try {
        let savePath = await Neutralino.os.showSaveDialog('Save Result');
        if (savePath) await Neutralino.filesystem.writeFile(savePath, result);
    } catch (err) { console.error('Save failed:', err); }
}
