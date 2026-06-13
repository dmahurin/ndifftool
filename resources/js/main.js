let files = [];
let editorInstance = null;
let currentLayout = 2;
let activeCM = null; 
let isEditMode = false;
let allEditors = []; 
let columnChunks = []; // Stored chunks for 4-column mode: [null, localChunks, remoteChunks, mergeChunks]
let fourColumnHighlights = [];

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
    Neutralino.events.on("windowClose", handleWindowClose);

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
                files.push({ path, content, originalContent: content, modified: false });
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
            if (cm === activeCM) {
                const line = cm.getCursor().line;
                cm.setSelection(
                    {line: Math.min(line + 1, cm.lineCount()), ch: 0},
                    {line, ch: 0},
                    {scroll: false}
                );
            } else if (from.line !== to.line || from.ch !== to.ch) {
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
            const range = selectedLineRange(cm);
            const line = Math.min(range.end - 1, cm.lastLine());
            cm.setSelection({line, ch: 0}, {line, ch: 0}, {scroll: true});
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
    } else if ((e.keyCode === 8 || e.keyCode === 46) && !isEditMode) { // Backspace or Delete
        e.preventDefault();
        cm.replaceSelection("");
    } else if (e.keyCode === 90 && (e.metaKey || e.ctrlKey) && !isEditMode) { // Cmd/Ctrl + Z
        e.preventDefault();
        cm.undo();
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
           // change to select by whole lines
           obj.ranges.forEach(range => {
                // drag up or down
                if (range.head.line <= range.anchor.line) {
                    range.anchor = {line: range.anchor.ch !=0 ? range.anchor.line + 1 : range.anchor.line, ch: 0}; //ch: cm.getLine(range.anchor.line).length};
                    if (range.head.outside && range.head.line) {
                      range.head = {line: range.head.line - 1, ch: cm.getLine(range.head.line - 1).length};
                    } else {
                      range.head = {line: range.head.line, ch: 0};
                    }
                } else {
                    range.anchor = {line: range.anchor.line, ch: 0};
                    range.head = {line: range.head.ch !=0 ? range.head.line + 1 : range.head.line, ch: 0};
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
        if (files[index]) {
            files[index].content = cm.getValue();
            files[index].modified = files[index].content !== files[index].originalContent;
        }
        if (currentLayout === 4) refreshFourColumnChunks();
    });
}

function setLayout(cols) {
    currentLayout = cols;
    allEditors = [];
    columnChunks = [];
    const container = document.getElementById('editor-container');
    container.innerHTML = ''; 

    if (cols === 2 || cols === 3) initMergeView(cols);
    else if (cols === 4) initFourColumnView();
}

function getTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'monokai' : 'default';
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const theme = getTheme();
    allEditors.forEach(cm => cm.setOption('theme', theme));
});

function initMergeView(cols) {
    const container = document.getElementById('editor-container');
    const mode = getMode(files[0]?.path);
    const theme = getTheme();
    const options = {
        lineNumbers: true, mode: mode,
        highlightDifferences: true, connect: 'align',
        collapseIdentical: false, theme: theme,
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
    
    lineDiffs.forEach(diff => {
        const op = diff[0];
        const text = diff[1];
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

function clearFourColumnHighlights() {
    fourColumnHighlights.forEach(({cm, line, className}) => {
        cm.removeLineClass(line, 'background', className);
    });
    fourColumnHighlights = [];
}

function addFourColumnLineClass(cm, line, className, seen) {
    if (!cm || line < cm.firstLine() || line > cm.lastLine()) return;

    const key = `${allEditors.indexOf(cm)}:${line}:${className}`;
    if (seen.has(key)) return;

    cm.addLineClass(line, 'background', className);
    fourColumnHighlights.push({cm, line, className});
    seen.add(key);
}

function addFourColumnRangeClass(cm, from, to, className, seen) {
    for (let line = from; line < to; line++) {
        addFourColumnLineClass(cm, line, className, seen);
    }
}

function applyFourColumnHighlights() {
    clearFourColumnHighlights();
    if (currentLayout !== 4 || allEditors.length < 4) return;

    const seen = new Set();
    for (let index = 1; index < 4; index++) {
        const cm = allEditors[index];
        const chunks = columnChunks[index] || [];

        chunks.forEach(chunk => {
            const hasBaseLines = chunk.origFrom < chunk.origTo;
            const hasPaneLines = chunk.editFrom < chunk.editTo;

            if (hasBaseLines && hasPaneLines) {
                addFourColumnRangeClass(allEditors[0], chunk.origFrom, chunk.origTo, 'ndiff-line-changed', seen);
                addFourColumnRangeClass(cm, chunk.editFrom, chunk.editTo, 'ndiff-line-changed', seen);
            } else if (hasBaseLines) {
                addFourColumnRangeClass(allEditors[0], chunk.origFrom, chunk.origTo, 'ndiff-line-deleted', seen);
            } else if (hasPaneLines) {
                addFourColumnRangeClass(cm, chunk.editFrom, chunk.editTo, 'ndiff-line-inserted', seen);
            }
        });
    }
}

function refreshFourColumnChunks() {
    if (files.length < 2) return;
    const base = files[0].content;
    columnChunks = [null];
    for (let i = 1; i < 4; i++) {
        if (files[i]) columnChunks[i] = getLineChunks(base, files[i].content);
        else columnChunks[i] = [];
    }
    applyFourColumnHighlights();
}

function initFourColumnView() {
    const container = document.getElementById('editor-container');
    const layout = document.createElement('div');
    layout.className = 'four-column-layout';
    container.appendChild(layout);

    const labels = ['BASE', 'LOCAL', 'REMOTE', 'MERGE'];
    const mode = getMode(files[0]?.path);
    const theme = getTheme();

    for (let i = 0; i < 4; i++) {
        const pane = document.createElement('div');
        const label = document.createElement('div');
        label.className = 'pane-label'; label.innerText = labels[i];
        pane.appendChild(label); layout.appendChild(pane);

        const cm = CodeMirror(pane, {
            value: files[i]?.content || '',
            lineNumbers: true, mode: mode, theme: theme
        });
        setupEditor(cm, i);
    }
    allEditors.forEach((cm, index) => {
        cm.on('scroll', (instance) => {
            const info = instance.getScrollInfo();
            allEditors.forEach((other, otherIndex) => {
                if (index !== otherIndex) other.scrollTo(info.left, info.top);
            });
        });
    });

    refreshFourColumnChunks();
}

function mapLineBoundary(chunks, line, fromOrig, isRangeEnd) {
    if (!chunks || chunks.length === 0) return line;
    let offset = 0;
    for (let c of chunks) {
        const sourceFrom = fromOrig ? c.origFrom : c.editFrom;
        const sourceTo = fromOrig ? c.origTo : c.editTo;
        const targetFrom = fromOrig ? c.editFrom : c.origFrom;
        const targetTo = fromOrig ? c.editTo : c.origTo;

        if (line < sourceFrom) return line + offset;
        if (line <= sourceTo) {
            if (sourceFrom === sourceTo) return isRangeEnd ? targetTo : targetFrom;
            if (line === sourceFrom) return targetFrom;
            if (line === sourceTo) return targetTo;
            return isRangeEnd ? targetTo : targetFrom;
        }
        offset = targetTo - sourceTo;
    }
    return line + offset;
}

function selectedLineRange(cm) {
    const from = cm.getCursor('from');
    const to = cm.getCursor('to');
    const end = to.ch === 0 && to.line > from.line ? to.line : to.line + 1;
    return {start: from.line, end};
}

function lineBoundaryPos(cm, line) {
    if (line >= cm.lineCount()) {
        const lastLine = cm.lastLine();
        return {line: lastLine, ch: cm.getLine(lastLine).length};
    }
    return {line, ch: 0};
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
    const sourceRange = selectedLineRange(activeCM);
    let targetStart, targetEnd;

    if (currentLayout === 4) {
        // Mapping in 4-column: Source -> BASE -> Target
        let baseStart = (currentIndex === 0) ? sourceRange.start : mapLineBoundary(columnChunks[currentIndex], sourceRange.start, false, false);
        let baseEnd = (currentIndex === 0) ? sourceRange.end : mapLineBoundary(columnChunks[currentIndex], sourceRange.end, false, true);
        
        targetStart = (targetIndex === 0) ? baseStart : mapLineBoundary(columnChunks[targetIndex], baseStart, true, false);
        targetEnd = (targetIndex === 0) ? baseEnd : mapLineBoundary(columnChunks[targetIndex], baseEnd, true, true);
    } else if (currentLayout === 2) {
        // 2-way: index 0 is edit, index 1 is right.orig
        const dv = editorInstance.right;
        const fromOrig = (currentIndex === 1);
        targetStart = mapLineBoundary(dv.chunks, sourceRange.start, fromOrig, false);
        targetEnd = mapLineBoundary(dv.chunks, sourceRange.end, fromOrig, true);
    } else if (currentLayout === 3) {
        // 3-way: index 0 is left.orig, 1 is edit, 2 is right.orig
        let dv, fromOrig;
        if (currentIndex === 0) { // Left to Center
            dv = editorInstance.left; fromOrig = true;
        } else if (currentIndex === 2) { // Right to Center
            dv = editorInstance.right; fromOrig = true;
        } else { // Center to Left or Right
            dv = (direction === 'left') ? editorInstance.left : editorInstance.right;
            fromOrig = false;
        }
        targetStart = mapLineBoundary(dv.chunks, sourceRange.start, fromOrig, false);
        targetEnd = mapLineBoundary(dv.chunks, sourceRange.end, fromOrig, true);
    }

    const text = activeCM.getRange(lineBoundaryPos(activeCM, sourceRange.start), lineBoundaryPos(activeCM, sourceRange.end));
    targetCM.replaceRange(text, lineBoundaryPos(targetCM, targetStart), lineBoundaryPos(targetCM, targetEnd));
    
    const newEndLine = targetStart + (sourceRange.end - sourceRange.start);
    // Reverse selection: anchor at bottom, head at top (ch 0)
    targetCM.setSelection(
        lineBoundaryPos(targetCM, newEndLine),
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
    const index = allEditors.indexOf(activeCM);
    const file = files[index];
    if (!file) return;

    try {
        file.content = activeCM.getValue();
        await Neutralino.filesystem.writeFile(file.path, file.content);
        file.originalContent = file.content;
        file.modified = false;
        updateFileInfo();
    } catch (err) {
        console.error('Save failed:', err);
    }
}

async function handleWindowClose() {
    const modifiedFiles = files.filter(f => f.modified);
    if (modifiedFiles.length === 0) {
        Neutralino.app.exit();
        return;
    }

    const modal = document.getElementById('save-modal');
    const list = document.getElementById('modified-files-list');
    list.innerHTML = '';

    modifiedFiles.forEach((file, i) => {
        const div = document.createElement('div');
        div.className = 'file-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `file-cb-${i}`;
        checkbox.checked = true;
        checkbox.dataset.path = file.path;
        
        const label = document.createElement('label');
        label.htmlFor = `file-cb-${i}`;
        label.innerText = file.path.split('/').pop();
        
        div.appendChild(checkbox);
        div.appendChild(label);
        list.appendChild(div);
    });

    modal.style.display = 'flex';

    document.getElementById('modal-save-btn').onclick = async () => {
        const checkboxes = list.querySelectorAll('input[type="checkbox"]');
        for (let cb of checkboxes) {
            if (cb.checked) {
                const path = cb.dataset.path;
                const file = files.find(f => f.path === path);
                if (file) {
                    try {
                        await Neutralino.filesystem.writeFile(path, file.content);
                    } catch (err) {
                        console.error(`Failed to save ${path}:`, err);
                    }
                }
            }
        }
        Neutralino.app.exit();
    };

    document.getElementById('modal-discard-btn').onclick = () => {
        Neutralino.app.exit();
    };

    document.getElementById('modal-cancel-btn').onclick = () => {
        modal.style.display = 'none';
    };
}
