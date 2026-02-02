// ============================================
// WE ÖTZI - Shared Drawer Logic
// Reusable drawer functionality for Quotes, Archive, and Calendar
// ============================================

// Drawer State
let currentQuoteNotes = [];
let editingNoteId = null;
let currentDescriptionQuoteId = null;
let quillEditor = null;
let noteToDelete = null;

// Lightbox State
let lightboxImages = [];
let lightboxCurrentIndex = 0;

// Rating State
let selectedReasons = new Set();

// Notes & Canvas State
let currentQuoteIdForNotes = null;
let selectedNoteLabel = null;
let canvasEditor = null;
let customCanvasLabels = [];

// Upload State
let currentUploadQuoteId = null;
let pendingUploadFiles = [];

// Chat State
let currentChatQuoteId = null;
let chatChannel = null;
let chatUnreadCount = 0;

// Sessions State
let currentQuoteSessions = [];
let editingSessionId = null;
let sessionToDelete = null;

// ============================================
// CANVAS EDITOR INITIALIZATION
// ============================================

async function initializeCanvasEditor(content = null) {
    // Destroy existing editor if any
    if (canvasEditor) {
        try {
            await canvasEditor.destroy();
        } catch (e) {
            console.warn('Error destroying previous editor:', e);
        }
        canvasEditor = null;
    }
    
    // Clear the editor container
    const editorHolder = document.getElementById('canvas-editor');
    if (editorHolder) {
        editorHolder.innerHTML = '';
    }
    
    // Build tools configuration based on available plugins
    const tools = {};
    
    if (typeof Header !== 'undefined') {
        tools.header = {
            class: Header,
            config: {
                placeholder: 'Titulo de seccion...',
                levels: [2, 3, 4],
                defaultLevel: 2
            }
        };
    }
    
    if (typeof List !== 'undefined') {
        tools.list = {
            class: List,
            inlineToolbar: true
        };
    }
    
    if (typeof Checklist !== 'undefined') {
        tools.checklist = {
            class: Checklist,
            inlineToolbar: true
        };
    }
    
    if (typeof Quote !== 'undefined') {
        tools.quote = {
            class: Quote,
            config: {
                quotePlaceholder: 'Escribe una cita...',
                captionPlaceholder: 'Autor'
            }
        };
    }
    
    if (typeof Delimiter !== 'undefined') {
        tools.delimiter = Delimiter;
    }
    
    if (typeof Marker !== 'undefined') {
        tools.marker = {
            class: Marker,
            shortcut: 'CMD+SHIFT+M'
        };
    }
    
    if (typeof InlineCode !== 'undefined') {
        tools.inlineCode = {
            class: InlineCode,
            shortcut: 'CMD+SHIFT+C'
        };
    }
    
    if (typeof Underline !== 'undefined') {
        tools.underline = Underline;
    }
    
    // Initialize EditorJS
    try {
        canvasEditor = new EditorJS({
            holder: 'canvas-editor',
            placeholder: 'Escribe aqui... Usa "/" para ver bloques disponibles',
            data: content || { blocks: [] },
            tools: tools,
            onReady: () => {
                // Editor ready
            }
        });
        
        await canvasEditor.isReady;
        
    } catch (error) {
        console.error('Error initializing EditorJS:', error);
    }
}

// ============================================
// CANVAS EXPORT & COPY FUNCTIONS
// ============================================

// Toggle export dropdown menu
window.toggleExportMenu = function() {
    const menu = document.getElementById('export-menu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
};

// Close export menu when clicking outside
document.addEventListener('click', function(e) {
    const exportDropdown = document.querySelector('.export-dropdown');
    const menu = document.getElementById('export-menu');
    if (exportDropdown && menu && !exportDropdown.contains(e.target)) {
        menu.style.display = 'none';
    }
});

// Helper function to convert EditorJS blocks to plain text
async function getCanvasContentAsText() {
    if (!canvasEditor) return '';
    
    try {
        const data = await canvasEditor.save();
        if (!data || !data.blocks || data.blocks.length === 0) return '';
        
        const textParts = [];
        
        for (const block of data.blocks) {
            switch (block.type) {
                case 'paragraph':
                    textParts.push(stripHtml(block.data.text));
                    break;
                case 'header':
                    textParts.push(stripHtml(block.data.text));
                    break;
                case 'list':
                    if (block.data.items) {
                        block.data.items.forEach((item, index) => {
                            const prefix = block.data.style === 'ordered' ? `${index + 1}.` : '-';
                            textParts.push(`${prefix} ${stripHtml(item)}`);
                        });
                    }
                    break;
                case 'checklist':
                    if (block.data.items) {
                        block.data.items.forEach(item => {
                            const checkbox = item.checked ? '[x]' : '[ ]';
                            textParts.push(`${checkbox} ${stripHtml(item.text)}`);
                        });
                    }
                    break;
                case 'quote':
                    textParts.push(`"${stripHtml(block.data.text)}"`);
                    if (block.data.caption) {
                        textParts.push(`- ${stripHtml(block.data.caption)}`);
                    }
                    break;
                case 'delimiter':
                    textParts.push('---');
                    break;
                default:
                    if (block.data.text) {
                        textParts.push(stripHtml(block.data.text));
                    }
            }
        }
        
        return textParts.join('\n');
    } catch (error) {
        console.error('Error getting canvas content:', error);
        return '';
    }
}

// Helper function to convert EditorJS blocks to HTML for PDF
async function getCanvasContentAsHTML() {
    if (!canvasEditor) return '';
    
    try {
        const data = await canvasEditor.save();
        if (!data || !data.blocks || data.blocks.length === 0) return '';
        
        const htmlParts = [];
        
        for (const block of data.blocks) {
            switch (block.type) {
                case 'paragraph':
                    htmlParts.push(`<p>${block.data.text}</p>`);
                    break;
                case 'header':
                    const level = block.data.level || 2;
                    htmlParts.push(`<h${level}>${block.data.text}</h${level}>`);
                    break;
                case 'list':
                    const tag = block.data.style === 'ordered' ? 'ol' : 'ul';
                    const items = block.data.items.map(item => `<li>${item}</li>`).join('');
                    htmlParts.push(`<${tag}>${items}</${tag}>`);
                    break;
                case 'checklist':
                    const checkItems = block.data.items.map(item => {
                        const checked = item.checked ? 'checked' : '';
                        return `<div class="checklist-item"><input type="checkbox" ${checked} disabled> ${item.text}</div>`;
                    }).join('');
                    htmlParts.push(`<div class="checklist">${checkItems}</div>`);
                    break;
                case 'quote':
                    let quoteHtml = `<blockquote><p>${block.data.text}</p>`;
                    if (block.data.caption) {
                        quoteHtml += `<cite>${block.data.caption}</cite>`;
                    }
                    quoteHtml += '</blockquote>';
                    htmlParts.push(quoteHtml);
                    break;
                case 'delimiter':
                    htmlParts.push('<hr>');
                    break;
                default:
                    if (block.data.text) {
                        htmlParts.push(`<p>${block.data.text}</p>`);
                    }
            }
        }
        
        return htmlParts.join('\n');
    } catch (error) {
        console.error('Error getting canvas HTML:', error);
        return '';
    }
}

// Helper to strip HTML tags
function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// Export canvas to PDF using html2pdf.js
window.exportCanvasToPDF = async function() {
    const title = document.getElementById('note-title')?.value || 'Canvas';
    const content = await getCanvasContentAsHTML();
    
    if (!content) {
        alert('No hay contenido para exportar');
        return;
    }
    
    // Create a container for PDF generation
    const pdfContainer = document.createElement('div');
    pdfContainer.style.cssText = 'padding: 20px; font-family: Arial, sans-serif; max-width: 800px;';
    pdfContainer.innerHTML = `
        <h1 style="font-size: 24px; margin-bottom: 10px; border-bottom: 2px solid #f5c518; padding-bottom: 10px;">${title}</h1>
        <div style="font-size: 12px; color: #666; margin-bottom: 20px;">
            Exportado: ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}
        </div>
        <div style="line-height: 1.6;">${content}</div>
    `;
    
    // PDF options
    const opt = {
        margin: [10, 10, 10, 10],
        filename: `${title.replace(/[^a-zA-Z0-9]/g, '_')}_canvas.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    try {
        // Close export menu
        const menu = document.getElementById('export-menu');
        if (menu) menu.style.display = 'none';
        
        // Generate PDF
        await html2pdf().set(opt).from(pdfContainer).save();
    } catch (error) {
        console.error('Error exporting PDF:', error);
        alert('Error al exportar PDF: ' + error.message);
    }
};

// Copy canvas content to clipboard
window.copyCanvasToClipboard = async function() {
    const title = document.getElementById('note-title')?.value || '';
    const content = await getCanvasContentAsText();
    
    if (!content && !title) {
        alert('No hay contenido para copiar');
        return;
    }
    
    const fullText = title ? `${title}\n\n${content}` : content;
    
    try {
        await navigator.clipboard.writeText(fullText);
        
        // Show brief success feedback
        const btn = event?.target?.closest('button');
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> COPIADO';
            btn.style.background = 'var(--bauhaus-blue, #1A4B8E)';
            btn.style.color = 'white';
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = '';
                btn.style.color = '';
            }, 2000);
        }
    } catch (error) {
        console.error('Error copying to clipboard:', error);
        alert('Error al copiar: ' + error.message);
    }
};

// Copy canvas content to chat input
window.copyCanvasToChat = async function() {
    const content = await getCanvasContentAsText();
    
    if (!content) {
        alert('No hay contenido para enviar al chat');
        return;
    }
    
    const chatInput = document.getElementById('drawer-chat-input');
    if (chatInput) {
        chatInput.value = content;
        chatInput.focus();
        closeNoteModal();
    } else {
        alert('El chat no esta disponible');
    }
};

// ============================================
// TOGGLE ADDITIONAL INFO
// ============================================

window.toggleAdditionalQuoteInfo = function() {
    const section = document.getElementById('additional-quote-info');
    const btn = document.getElementById('expand-quote-info-btn');
    
    if (section.style.display === 'none') {
        section.style.display = 'block';
        btn.textContent = 'OCULTAR INFORMACION';
    } else {
        section.style.display = 'none';
        btn.textContent = 'AMPLIAR INFORMACION';
    }
};

// ============================================
// STYLE HELPERS
// ============================================

function getStyleDisplayName(tattooStyle) {
    if (!tattooStyle) return 'TBD';
    if (typeof tattooStyle === 'string') return tattooStyle;
    if (typeof tattooStyle === 'object') {
        if (tattooStyle.substyle_name) {
            return `${tattooStyle.style_name} - ${tattooStyle.substyle_name}`;
        }
        return tattooStyle.style_name || 'TBD';
    }
    return 'TBD';
}

// ============================================
// IMAGE HELPERS
// ============================================

function getDriveThumbnail(url) {
    if (!url || !url.includes('drive.google.com')) return null;
    let fileId = '';
    if (url.includes('/d/')) fileId = url.split('/d/')[1].split('/')[0];
    else if (url.includes('id=')) fileId = url.split('id=')[1].split('&')[0];
    return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w400` : null;
}

function getDriveFullImage(url) {
    if (!url || !url.includes('drive.google.com')) return url;
    let fileId = '';
    if (url.includes('/d/')) fileId = url.split('/d/')[1].split('/')[0];
    else if (url.includes('id=')) fileId = url.split('id=')[1].split('&')[0];
    return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200` : url;
}

// ============================================
// LIGHTBOX FUNCTIONS
// ============================================

window.openLightbox = function(index) {
    if (lightboxImages.length === 0) return;
    
    lightboxCurrentIndex = index;
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    const currentSpan = document.getElementById('lightbox-current');
    const totalSpan = document.getElementById('lightbox-total');
    
    img.src = getDriveFullImage(lightboxImages[lightboxCurrentIndex]);
    currentSpan.textContent = lightboxCurrentIndex + 1;
    totalSpan.textContent = lightboxImages.length;
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
};

window.closeLightbox = function(event) {
    if (event && event.target !== event.currentTarget && !event.target.classList.contains('lightbox-close')) {
        return;
    }
    const modal = document.getElementById('lightbox-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
};

window.lightboxPrev = function(event) {
    event.stopPropagation();
    if (lightboxImages.length <= 1) return;
    lightboxCurrentIndex = (lightboxCurrentIndex - 1 + lightboxImages.length) % lightboxImages.length;
    updateLightboxImage();
};

window.lightboxNext = function(event) {
    event.stopPropagation();
    if (lightboxImages.length <= 1) return;
    lightboxCurrentIndex = (lightboxCurrentIndex + 1) % lightboxImages.length;
    updateLightboxImage();
};

function updateLightboxImage() {
    const img = document.getElementById('lightbox-img');
    const currentSpan = document.getElementById('lightbox-current');
    img.src = getDriveFullImage(lightboxImages[lightboxCurrentIndex]);
    currentSpan.textContent = lightboxCurrentIndex + 1;
}

document.addEventListener('keydown', function(e) {
    const modal = document.getElementById('lightbox-modal');
    if (!modal || !modal.classList.contains('active')) return;
    
    if (e.key === 'Escape') closeLightbox({ target: modal, currentTarget: modal });
    else if (e.key === 'ArrowLeft') lightboxPrev({ stopPropagation: () => {} });
    else if (e.key === 'ArrowRight') lightboxNext({ stopPropagation: () => {} });
});

// ============================================
// RATING LOGIC
// ============================================

window.setRatingReason = function(btn, reason) {
    if (selectedReasons.has(reason)) {
        selectedReasons.delete(reason);
        btn.style.background = 'var(--bauhaus-yellow)';
        btn.style.color = 'var(--ink)';
    } else {
        selectedReasons.add(reason);
        btn.style.background = 'var(--bauhaus-red)';
        btn.style.color = 'white';
    }
};

window.submitRating = function(quoteId, rating) {
    if (selectedReasons.size === 0) {
        alert('Por favor selecciona al menos un motivo.');
        return;
    }
    const reasonStr = Array.from(selectedReasons).join(', ');
    saveRating(quoteId, rating, reasonStr);
};

window.openRatingModal = function(quoteId, rating) {
    const drawerContent = document.getElementById('drawer-content');
    const ratingArea = Array.from(drawerContent.querySelectorAll('button')).find(b => b.textContent.includes('Interesante'))?.parentNode;
    
    const reasons = ["PRESUPUESTO", "IDEA", "FECHA", "UBICACION DEL CLIENTE", "PARTE DEL CUERPO", "ES UN COVER", "COLOR", "OTRO"];
    selectedReasons.clear();

    if (ratingArea) {
        ratingArea.innerHTML = `
            <div class="rating-form" style="width: 100%; background: #f5f5f5; padding: 1rem; border: var(--border-main);">
                <h3 style="font-family: 'Space Mono'; font-size: 0.8rem; margin-bottom: 0.5rem;">POR QUE ES ${rating.toUpperCase()}?</h3>
                <div class="rating-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 1rem;">
                    ${reasons.map(r => `<button class="action-btn" style="font-size: 0.6rem; padding: 5px;" onclick="setRatingReason(this, '${r}')">${r}</button>`).join('')}
                </div>
                <textarea id="rating-comment" placeholder="Comentario opcional..." style="width: 100%; height: 60px; padding: 10px; border: var(--border-main); margin-bottom: 10px;"></textarea>
                <div style="display: flex; gap: 10px;">
                    <button class="action-btn" style="background: var(--ink); color: white; flex: 1;" onclick="submitRating('${quoteId}', '${rating}')">Guardar</button>
                    <button class="action-btn" style="flex: 1;" onclick="inspectQuote('${quoteId}')">Cancelar</button>
                </div>
            </div>`;
    }
};

window.saveRating = async function(quoteId, rating, reason) {
    const comment = document.getElementById('rating-comment')?.value || '';
    try {
        const { error } = await _supabase.from('quotations_db').update({ rating, rating_reason: reason, rating_comment: comment }).eq('id', quoteId);
        if (error) throw error;
        const quote = quotations.find(q => q.id.toString() === quoteId.toString());
        if (quote) { quote.rating = rating; quote.rating_reason = reason; quote.rating_comment = comment; }
        inspectQuote(quoteId);
    } catch (err) { alert('Error saving rating: ' + err.message); }
};

// ============================================
// STATUS & PRIORITY MANAGEMENT
// ============================================

window.updateQuoteStatus = async function(quoteId, newStatus) {
    try {
        const { error } = await _supabase.from('quotations_db').update({ quote_status: newStatus }).eq('id', quoteId);
        if (error) throw error;
        const quote = quotations.find(q => q.id.toString() === quoteId.toString());
        if (quote) quote.quote_status = newStatus;
        if (typeof applyFiltersAndSort === 'function') applyFiltersAndSort();
        if (typeof updateStats === 'function') updateStats();
        inspectQuote(quoteId);
    } catch (err) { console.error('Error updating status:', err); }
};

window.updateQuotePriority = async function(quoteId, newPriority) {
    try {
        const { error } = await _supabase.from('quotations_db').update({ priority: newPriority }).eq('id', quoteId);
        if (error) throw error;
        const quote = quotations.find(q => q.id.toString() === quoteId.toString());
        if (quote) quote.priority = newPriority;
        if (typeof applyFiltersAndSort === 'function') applyFiltersAndSort();
        const prioritySelect = document.querySelector('.priority-dropdown');
        if (prioritySelect) prioritySelect.className = `priority-dropdown priority-${newPriority}`;
    } catch (err) { 
        console.error('Error updating priority:', err);
        alert('Error updating priority: ' + err.message);
    }
};

// ============================================
// NOTES SYSTEM
// ============================================

async function loadNotesForQuote(quoteId) {
    try {
        const { data, error } = await _supabase
            .from('quotation_notes')
            .select('*')
            .eq('quotation_id', quoteId)
            .order('note_date', { ascending: false });
        
        if (error) throw error;
        currentQuoteNotes = data || [];
        return currentQuoteNotes;
    } catch (err) {
        console.error('Error loading notes:', err);
        currentQuoteNotes = [];
        return [];
    }
}

window.openNoteModal = async function(quoteId, noteId = null) {
    currentQuoteIdForNotes = quoteId;
    editingNoteId = noteId;
    selectedNoteLabel = null;
    
    const modal = document.getElementById('note-modal');
    const title = document.getElementById('note-modal-title');
    
    document.getElementById('note-title').value = '';
    document.getElementById('note-date').value = new Date().toISOString().slice(0, 16);
    document.querySelectorAll('.label-btn').forEach(btn => btn.classList.remove('active'));
    
    // Prepare content for editor (empty for new, loaded for edit)
    let editorContent = null;
    
    if (noteId) {
        title.textContent = 'Editar Canvas';
        const note = currentQuoteNotes.find(n => n.id === noteId);
        if (note) {
            document.getElementById('note-title').value = note.title || '';
            if (note.note_date) {
                document.getElementById('note-date').value = new Date(note.note_date).toISOString().slice(0, 16);
            }
            if (note.label) {
                selectedNoteLabel = note.label;
                const labelBtn = document.querySelector(`.label-btn[data-label="${note.label}"]`);
                if (labelBtn) labelBtn.classList.add('active');
            }
            // Load existing content for editing (content is already jsonb from database)
            if (note.content) {
                editorContent = note.content;
            }
        }
    } else {
        title.textContent = 'Nuevo Canvas';
    }
    
    modal.style.display = 'flex';
    
    // Initialize EditorJS after modal is visible
    await initializeCanvasEditor(editorContent);
    
    // Show copy-to-chat button only if chat input exists (chat is available)
    const chatInput = document.getElementById('drawer-chat-input');
    const copyToChatBtn = document.getElementById('copy-to-chat-btn');
    if (copyToChatBtn) {
        copyToChatBtn.style.display = chatInput ? 'inline-flex' : 'none';
    }
};

window.closeNoteModal = async function() {
    document.getElementById('note-modal').style.display = 'none';
    editingNoteId = null;
    currentQuoteIdForNotes = null;
    selectedNoteLabel = null;
    
    // Destroy editor to prevent memory leaks
    if (canvasEditor) {
        try {
            await canvasEditor.destroy();
        } catch (e) {
            console.warn('Error destroying editor on close:', e);
        }
        canvasEditor = null;
    }
};

window.selectNoteLabel = function(btn) {
    document.querySelectorAll('.label-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedNoteLabel = btn.dataset.label;
};

window.saveNote = async function() {
    const title = document.getElementById('note-title').value.trim();
    const dateValue = document.getElementById('note-date').value;
    
    if (!title) {
        alert('El titulo del canvas es requerido');
        return;
    }
    
    const quoteIdToRefresh = currentQuoteIdForNotes;
    
    // Get editor content
    let editorContent = null;
    if (canvasEditor) {
        try {
            editorContent = await canvasEditor.save();
        } catch (e) {
            console.warn('Error saving editor content:', e);
        }
    }
    
    const noteData = {
        quotation_id: parseInt(quoteIdToRefresh),
        title,
        label: selectedNoteLabel,
        content: editorContent || null,
        note_date: dateValue ? new Date(dateValue).toISOString() : new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    try {
        if (editingNoteId) {
            const { error } = await _supabase.from('quotation_notes').update(noteData).eq('id', editingNoteId);
            if (error) throw error;
        } else {
            noteData.created_at = new Date().toISOString();
            const { error } = await _supabase.from('quotation_notes').insert([noteData]);
            if (error) throw error;
        }
        
        closeNoteModal();
        if (quoteIdToRefresh) await inspectQuote(quoteIdToRefresh);
    } catch (err) {
        console.error('Error saving note:', err);
        alert('Error al guardar el canvas: ' + err.message);
    }
};

window.openDeleteNoteConfirm = function(noteId) {
    noteToDelete = noteId;
    document.getElementById('delete-confirm-modal').style.display = 'flex';
};

window.closeDeleteConfirmModal = function() {
    document.getElementById('delete-confirm-modal').style.display = 'none';
    noteToDelete = null;
};

window.confirmDeleteNote = async function() {
    if (!noteToDelete) return;
    
    const note = currentQuoteNotes.find(n => n.id === noteToDelete);
    const quoteIdToRefresh = note ? note.quotation_id : null;
    
    try {
        const { error } = await _supabase.from('quotation_notes').delete().eq('id', noteToDelete);
        if (error) throw error;
        
        closeDeleteConfirmModal();
        if (quoteIdToRefresh) await inspectQuote(quoteIdToRefresh);
    } catch (err) {
        console.error('Error deleting note:', err);
        alert('Error al eliminar la nota: ' + err.message);
    }
};

function getLabelColor(label) {
    const colors = {
        'interno': 'var(--bauhaus-blue)',
        'urgente': 'var(--bauhaus-red)',
        'seguimiento': 'var(--bauhaus-yellow)',
        'referencia': '#9b59b6',
        'otro': '#7f8c8d'
    };
    return colors[label] || '#2ecc71';
}

function renderNotesSection(quoteId, notes, readOnly = false) {
    if (!notes || notes.length === 0) {
        return `
            <div class="notes-section artist-notepad" style="margin-top: 2rem;">
                <div class="notepad-header">
                    <div class="notepad-title"><span>ARTIST NOTEPAD</span></div>
                    <span class="notepad-count">0 Canvas</span>
                </div>
                <div class="notes-empty notepad-empty">
                    <p>SIN_CANVAS_REGISTRADOS</p>
                    ${!readOnly ? `<button class="action-btn" onclick="openNoteModal('${quoteId}')">NUEVO CANVAS</button>` : ''}
                </div>
            </div>
        `;
    }
    
    const notesHtml = notes.map(note => {
        const noteDate = note.note_date ? new Date(note.note_date).toLocaleDateString('es-ES', { 
            day: '2-digit', month: 'short', year: 'numeric'
        }) : '-';
        
        const labelBadge = note.label ? `<span class="note-label" style="background: ${getLabelColor(note.label)};">${note.label.toUpperCase()}</span>` : '';
        
        const actionsHtml = readOnly ? '' : `
            <div class="note-actions">
                <button class="note-action-btn" onclick="openNoteModal('${quoteId}', '${note.id}')" title="Editar">EDIT</button>
                <button class="note-action-btn danger" onclick="openDeleteNoteConfirm('${note.id}')" title="Eliminar">DEL</button>
            </div>
        `;
        
        return `
            <div class="note-card canvas-card">
                <div class="note-header">
                    <div class="note-title-row">
                        <h4 class="note-title">${note.title || 'Sin titulo'}</h4>
                        ${labelBadge}
                    </div>
                    <span class="note-date">${noteDate}</span>
                </div>
                ${actionsHtml}
            </div>
        `;
    }).join('');
    
    return `
        <div class="notes-section artist-notepad" style="margin-top: 2rem;">
            <div class="notepad-header">
                <div class="notepad-title"><span>ARTIST NOTEPAD</span></div>
                <div class="notepad-actions">
                    <span class="notepad-count">${notes.length} Canvas</span>
                    ${!readOnly ? `<button class="action-btn small-btn" onclick="openNoteModal('${quoteId}')">NUEVO</button>` : ''}
                </div>
            </div>
            <div class="notes-list canvas-list">${notesHtml}</div>
        </div>
    `;
}

// ============================================
// SESSIONS MANAGEMENT SYSTEM
// ============================================

async function loadSessionsForQuote(quoteId) {
    try {
        const { data, error } = await _supabase
            .from('quotation_sessions')
            .select('*')
            .eq('quotation_id', quoteId)
            .order('session_date', { ascending: true });
        
        if (error) throw error;
        currentQuoteSessions = data || [];
        return currentQuoteSessions;
    } catch (err) {
        console.error('Error loading sessions:', err);
        currentQuoteSessions = [];
        return [];
    }
}

function getSessionStatusLabel(status) {
    const labels = {
        'scheduled': 'AGENDADA',
        'completed': 'COMPLETADA',
        'no_show': 'NO ASISTIO',
        'rescheduled': 'REPROGRAMADA',
        'cancelled': 'CANCELADA'
    };
    return labels[status] || status.toUpperCase();
}

function getSessionStatusColor(status) {
    const colors = {
        'scheduled': 'var(--bauhaus-blue, #1A4B8E)',
        'completed': '#27ae60',
        'no_show': 'var(--bauhaus-red, #C62828)',
        'rescheduled': 'var(--bauhaus-yellow, #F5C518)',
        'cancelled': '#7f8c8d'
    };
    return colors[status] || '#666';
}

window.openSessionModal = function(quoteId, sessionId = null) {
    editingSessionId = sessionId;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('session-modal');
    if (existingModal) existingModal.remove();
    
    let sessionData = {
        session_date: '',
        duration_hours: '',
        notes: '',
        status: 'scheduled'
    };
    
    if (sessionId) {
        const session = currentQuoteSessions.find(s => s.id === sessionId);
        if (session) {
            sessionData = {
                session_date: session.session_date ? new Date(session.session_date).toISOString().slice(0, 16) : '',
                duration_hours: session.duration_hours || '',
                notes: session.notes || '',
                status: session.status || 'scheduled'
            };
        }
    }
    
    const nextSessionNumber = currentQuoteSessions.length + 1;
    const modalTitle = sessionId ? 'EDITAR SESION' : `NUEVA SESION (#${nextSessionNumber})`;
    
    const modalHtml = `
        <div id="session-modal" class="modal-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; justify-content: center; align-items: center;">
            <div class="modal-container" style="background: white; padding: 2rem; border-radius: 8px; width: 90%; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h3 style="margin: 0; font-family: 'Space Mono', monospace;">${modalTitle}</h3>
                    <button onclick="closeSessionModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">FECHA Y HORA *</label>
                        <input type="datetime-local" id="session-date" value="${sessionData.session_date}" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;" required>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">DURACION ESTIMADA (horas)</label>
                        <input type="number" id="session-duration" value="${sessionData.duration_hours}" placeholder="Ej: 2, 3.5" step="0.5" min="0.5" max="12" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    
                    ${sessionId ? `
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">ESTADO</label>
                        <select id="session-status" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                            <option value="scheduled" ${sessionData.status === 'scheduled' ? 'selected' : ''}>Agendada</option>
                            <option value="completed" ${sessionData.status === 'completed' ? 'selected' : ''}>Completada</option>
                            <option value="no_show" ${sessionData.status === 'no_show' ? 'selected' : ''}>No Asistio</option>
                            <option value="rescheduled" ${sessionData.status === 'rescheduled' ? 'selected' : ''}>Reprogramada</option>
                            <option value="cancelled" ${sessionData.status === 'cancelled' ? 'selected' : ''}>Cancelada</option>
                        </select>
                    </div>
                    ` : ''}
                    
                    <div class="form-group" style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">NOTAS DE LA SESION</label>
                        <textarea id="session-notes" rows="4" placeholder="Notas, observaciones, progreso del tatuaje..." style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${sessionData.notes}</textarea>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; gap: 1rem; justify-content: flex-end;">
                    <button class="action-btn" onclick="closeSessionModal()" style="background: #f5f5f5; color: #333;">CANCELAR</button>
                    <button class="action-btn accept-btn" onclick="saveSession('${quoteId}')" style="background: var(--bauhaus-blue, #1A4B8E); color: white;">GUARDAR</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.closeSessionModal = function() {
    const modal = document.getElementById('session-modal');
    if (modal) modal.remove();
    editingSessionId = null;
};

window.saveSession = async function(quoteId) {
    const sessionDate = document.getElementById('session-date').value;
    const duration = document.getElementById('session-duration').value;
    const notes = document.getElementById('session-notes').value;
    const statusEl = document.getElementById('session-status');
    const status = statusEl ? statusEl.value : 'scheduled';
    
    if (!sessionDate) {
        alert('Por favor selecciona la fecha y hora de la sesion.');
        return;
    }
    
    try {
        if (editingSessionId) {
            // Update existing session
            const updateData = {
                session_date: new Date(sessionDate).toISOString(),
                duration_hours: duration ? parseFloat(duration) : null,
                notes: notes || null,
                status: status
            };
            
            const { error } = await _supabase
                .from('quotation_sessions')
                .update(updateData)
                .eq('id', editingSessionId);
            
            if (error) throw error;
        } else {
            // Create new session
            const nextNumber = currentQuoteSessions.length + 1;
            const sessionData = {
                quotation_id: parseInt(quoteId),
                session_number: nextNumber,
                session_date: new Date(sessionDate).toISOString(),
                duration_hours: duration ? parseFloat(duration) : null,
                status: 'scheduled',
                notes: notes || null
            };
            
            const { error } = await _supabase
                .from('quotation_sessions')
                .insert([sessionData]);
            
            if (error) throw error;
        }
        
        closeSessionModal();
        await inspectQuote(quoteId);
        
    } catch (err) {
        console.error('Error saving session:', err);
        alert('Error al guardar la sesion: ' + err.message);
    }
};

window.updateSessionStatus = async function(sessionId, newStatus, quoteId) {
    try {
        const { error } = await _supabase
            .from('quotation_sessions')
            .update({ status: newStatus })
            .eq('id', sessionId);
        
        if (error) throw error;
        
        // Update local state
        const session = currentQuoteSessions.find(s => s.id === sessionId);
        if (session) session.status = newStatus;
        
        await inspectQuote(quoteId);
        
    } catch (err) {
        console.error('Error updating session status:', err);
        alert('Error al actualizar el estado: ' + err.message);
    }
};

window.openDeleteSessionConfirm = function(sessionId) {
    sessionToDelete = sessionId;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('delete-session-confirm-modal');
    if (existingModal) existingModal.remove();
    
    const modalHtml = `
        <div id="delete-session-confirm-modal" class="modal-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2100; justify-content: center; align-items: center;">
            <div class="modal-container" style="background: white; padding: 2rem; border-radius: 8px; width: 90%; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
                <h3 style="margin: 0 0 1rem 0; font-family: 'Space Mono', monospace;">ELIMINAR SESION</h3>
                <p style="margin-bottom: 1.5rem; color: #666;">Estas seguro de que deseas eliminar esta sesion? Esta accion no se puede deshacer.</p>
                <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                    <button class="action-btn" onclick="closeDeleteSessionConfirm()" style="background: #f5f5f5; color: #333;">CANCELAR</button>
                    <button class="action-btn" onclick="confirmDeleteSession()" style="background: var(--bauhaus-red, #C62828); color: white;">ELIMINAR</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.closeDeleteSessionConfirm = function() {
    const modal = document.getElementById('delete-session-confirm-modal');
    if (modal) modal.remove();
    sessionToDelete = null;
};

window.confirmDeleteSession = async function() {
    if (!sessionToDelete) return;
    
    const session = currentQuoteSessions.find(s => s.id === sessionToDelete);
    const quoteIdToRefresh = session ? session.quotation_id : null;
    
    try {
        const { error } = await _supabase
            .from('quotation_sessions')
            .delete()
            .eq('id', sessionToDelete);
        
        if (error) throw error;
        
        closeDeleteSessionConfirm();
        if (quoteIdToRefresh) await inspectQuote(quoteIdToRefresh);
        
    } catch (err) {
        console.error('Error deleting session:', err);
        alert('Error al eliminar la sesion: ' + err.message);
    }
};

function renderSessionsSection(quoteId, sessions, readOnly = false) {
    if (!sessions || sessions.length === 0) {
        return `
            <div class="sessions-section" style="margin-top: 2rem; padding: 1.5rem; background: #fafafa; border: 2px dashed var(--ink, #1A1A1A);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h4 style="margin: 0; font-family: 'Space Mono', monospace; font-size: 0.85rem;">SESIONES PROGRAMADAS</h4>
                    <span style="font-size: 0.7rem; color: #888;">0 Sesiones</span>
                </div>
                <div style="text-align: center; padding: 1.5rem; color: #888;">
                    <p style="font-family: 'Space Mono', monospace; font-size: 0.75rem; margin-bottom: 1rem;">SIN_SESIONES_PROGRAMADAS</p>
                    ${!readOnly ? `<button class="action-btn" onclick="openSessionModal('${quoteId}')" style="font-size: 0.75rem;">AGREGAR SESION</button>` : ''}
                </div>
            </div>
        `;
    }
    
    const sessionsHtml = sessions.map((session, index) => {
        const sessionDate = session.session_date 
            ? new Date(session.session_date).toLocaleDateString('es-ES', { 
                weekday: 'short',
                day: '2-digit', 
                month: 'short', 
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }) 
            : '-';
        
        const statusColor = getSessionStatusColor(session.status);
        const statusLabel = getSessionStatusLabel(session.status);
        
        const actionsHtml = readOnly ? '' : `
            <div class="session-actions" style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                <select onchange="updateSessionStatus('${session.id}', this.value, '${quoteId}')" 
                    style="flex: 1; padding: 0.4rem; font-size: 0.7rem; border: 1px solid #ddd; border-radius: 4px;">
                    <option value="scheduled" ${session.status === 'scheduled' ? 'selected' : ''}>Agendada</option>
                    <option value="completed" ${session.status === 'completed' ? 'selected' : ''}>Completada</option>
                    <option value="no_show" ${session.status === 'no_show' ? 'selected' : ''}>No Asistio</option>
                    <option value="rescheduled" ${session.status === 'rescheduled' ? 'selected' : ''}>Reprogramada</option>
                    <option value="cancelled" ${session.status === 'cancelled' ? 'selected' : ''}>Cancelada</option>
                </select>
                <button class="action-btn small-btn" onclick="openSessionModal('${quoteId}', '${session.id}')" 
                    style="padding: 0.4rem 0.6rem; font-size: 0.65rem;">EDIT</button>
                <button class="action-btn small-btn" onclick="openDeleteSessionConfirm('${session.id}')" 
                    style="padding: 0.4rem 0.6rem; font-size: 0.65rem; background: var(--bauhaus-red, #C62828); color: white;">DEL</button>
            </div>
        `;
        
        return `
            <div class="session-card" style="padding: 1rem; background: white; border: 1px solid #ddd; margin-bottom: 0.75rem; border-left: 4px solid ${statusColor};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <div>
                        <span style="font-family: 'Space Mono', monospace; font-size: 0.85rem; font-weight: bold;">SESION #${session.session_number || index + 1}</span>
                        ${session.duration_hours ? `<span style="font-size: 0.7rem; color: #888; margin-left: 0.5rem;">(${session.duration_hours}h)</span>` : ''}
                    </div>
                    <span style="font-size: 0.65rem; padding: 0.25rem 0.5rem; background: ${statusColor}; color: white; border-radius: 2px;">${statusLabel}</span>
                </div>
                <p style="font-size: 0.8rem; color: #333; margin: 0.25rem 0;">${sessionDate}</p>
                ${session.notes ? `<p style="font-size: 0.75rem; color: #666; margin-top: 0.5rem; font-style: italic; border-left: 2px solid #ddd; padding-left: 0.5rem;">${session.notes}</p>` : ''}
                ${actionsHtml}
            </div>
        `;
    }).join('');
    
    const completedCount = sessions.filter(s => s.status === 'completed').length;
    const totalCount = sessions.length;
    
    return `
        <div class="sessions-section" style="margin-top: 2rem; padding: 1.5rem; background: #fafafa; border: 2px solid var(--bauhaus-yellow, #F5C518);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h4 style="margin: 0; font-family: 'Space Mono', monospace; font-size: 0.85rem;">SESIONES PROGRAMADAS</h4>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span style="font-size: 0.7rem; color: #888;">${completedCount}/${totalCount} completadas</span>
                    ${!readOnly ? `<button class="action-btn small-btn" onclick="openSessionModal('${quoteId}')" style="font-size: 0.7rem; padding: 0.4rem 0.8rem;">+ AGREGAR</button>` : ''}
                </div>
            </div>
            <div class="sessions-list">${sessionsHtml}</div>
        </div>
    `;
}

// ============================================
// CHAT FUNCTIONS FOR ARTIST DRAWER
// ============================================

async function loadChatMessages(quoteId) {
    if (!quoteId) return [];
    
    try {
        const quote = quotations.find(q => q.id.toString() === quoteId.toString());
        if (!quote || !quote.quote_id) return [];
        
        const { data: messages, error } = await _supabase
            .from('chat_messages')
            .select('*')
            .eq('quotation_id', quote.quote_id)
            .order('created_at', { ascending: true });
        
        if (error) {
            console.error('Error loading chat messages:', error);
            return [];
        }
        
        return messages || [];
    } catch (err) {
        console.error('Error in loadChatMessages:', err);
        return [];
    }
}

function renderChatSection(quoteId, messages, readOnly = false) {
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote || !quote.quote_id) {
        return '';
    }
    
    // Check if client has an account
    const hasClientAccount = quote.client_user_id !== null;
    
    if (!hasClientAccount) {
        return `
            <div class="chat-section" style="margin-top: 3rem;">
                <label style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; font-family: 'Space Mono', monospace; font-size: 0.65rem; text-transform: uppercase; color: #888;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    Chat con Cliente
                </label>
                <div class="chat-not-available" style="padding: 1.5rem; background: #f5f5f5; text-align: center; margin-top: 0.5rem; border: 1px solid #ddd; color: var(--text-on-light, #121212);">
                    <p style="font-family: 'Space Mono', monospace; font-size: 0.75rem; opacity: 0.6;">
                        El cliente aun no tiene cuenta.<br>
                        El chat se habilitara cuando cree su cuenta.
                    </p>
                </div>
            </div>
        `;
    }
    
    const messagesHtml = messages.length > 0 
        ? messages.map(msg => `
            <div class="chat-message ${msg.sender_type}" style="
                max-width: 85%;
                padding: 0.75rem 1rem;
                margin-bottom: 0.5rem;
                font-size: 0.85rem;
                line-height: 1.4;
                ${msg.sender_type === 'artist' 
                    ? 'align-self: flex-end; background: var(--bauhaus-blue, #1A4B8E); color: white; margin-left: auto;' 
                    : 'align-self: flex-start; background: #f5f5f5; border: 1px solid #ddd; color: var(--text-on-light, #121212);'}
            ">
                <div>${escapeHtml(msg.message)}</div>
                <span style="font-size: 0.65rem; opacity: 0.6; display: block; margin-top: 0.25rem;">
                    ${formatChatTime(msg.created_at)}
                    ${msg.sender_type === 'artist' && msg.is_read ? ' ✓✓' : ''}
                </span>
            </div>
        `).join('')
        : `<div style="text-align: center; padding: 2rem; opacity: 0.5; font-family: 'Space Mono', monospace; font-size: 0.75rem;">
            Inicia la conversacion con el cliente
        </div>`;
    
    return `
        <div class="chat-section" style="margin-top: 3rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; font-family: 'Space Mono', monospace; font-size: 0.65rem; text-transform: uppercase; color: #888;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Chat con Cliente
                ${chatUnreadCount > 0 ? `<span class="chat-unread-badge" style="background: var(--bauhaus-red); color: white; padding: 0.15rem 0.4rem; font-size: 0.65rem; border-radius: 10px;">${chatUnreadCount}</span>` : ''}
            </label>
            <div id="drawer-chat-messages" style="
                max-height: 250px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                padding: 0.75rem;
                background: #fafafa;
                border: 1px solid #ddd;
                margin-top: 0.5rem;
                color: var(--text-on-light, #121212);
            ">
                ${messagesHtml}
            </div>
            ${!readOnly ? `
                <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                    <input type="text" id="drawer-chat-input" placeholder="Escribe un mensaje..." 
                        style="flex: 1; padding: 0.75rem; border: 1px solid #ddd; font-size: 0.85rem;"
                        onkeydown="if(event.key==='Enter')sendDrawerChatMessage('${quoteId}')"
                    >
                    <button class="action-btn" onclick="sendDrawerChatMessage('${quoteId}')" 
                        style="padding: 0.75rem 1rem; background: var(--bauhaus-blue, #1A4B8E); color: white;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"/>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

window.sendDrawerChatMessage = async function(quoteId) {
    const input = document.getElementById('drawer-chat-input');
    if (!input) return;
    
    const message = input.value.trim();
    if (!message) return;
    
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote || !quote.quote_id) return;
    
    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) return;
        
        const { error } = await _supabase
            .from('chat_messages')
            .insert({
                quotation_id: quote.quote_id,
                sender_type: 'artist',
                sender_id: session.user.id,
                message: message
            });
        
        if (error) throw error;
        
        // Clear input
        input.value = '';
        
        // Reload messages
        const messages = await loadChatMessages(quoteId);
        const container = document.getElementById('drawer-chat-messages');
        if (container) {
            container.innerHTML = messages.map(msg => `
                <div class="chat-message ${msg.sender_type}" style="
                    max-width: 85%;
                    padding: 0.75rem 1rem;
                    margin-bottom: 0.5rem;
                    font-size: 0.85rem;
                    line-height: 1.4;
                    ${msg.sender_type === 'artist' 
                        ? 'align-self: flex-end; background: var(--bauhaus-blue, #1A4B8E); color: white; margin-left: auto;' 
                        : 'align-self: flex-start; background: #f5f5f5; border: 1px solid #ddd;'}
                ">
                    <div>${escapeHtml(msg.message)}</div>
                    <span style="font-size: 0.65rem; opacity: 0.6; display: block; margin-top: 0.25rem;">
                        ${formatChatTime(msg.created_at)}
                    </span>
                </div>
            `).join('');
            container.scrollTop = container.scrollHeight;
        }
        
    } catch (err) {
        console.error('Error sending message:', err);
        alert('Error al enviar el mensaje');
    }
};

async function markChatMessagesAsRead(quoteId) {
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote || !quote.quote_id) return;
    
    try {
        await _supabase
            .from('chat_messages')
            .update({ is_read: true })
            .eq('quotation_id', quote.quote_id)
            .eq('sender_type', 'client')
            .eq('is_read', false);
        
        chatUnreadCount = 0;
    } catch (err) {
        console.error('Error marking messages as read:', err);
    }
}

async function getUnreadChatCount(quoteId) {
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote || !quote.quote_id) return 0;
    
    try {
        const { count } = await _supabase
            .from('chat_messages')
            .select('*', { count: 'exact', head: true })
            .eq('quotation_id', quote.quote_id)
            .eq('sender_type', 'client')
            .eq('is_read', false);
        
        return count || 0;
    } catch (err) {
        return 0;
    }
}

function formatChatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function subscribeToChatUpdates(quoteId) {
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote || !quote.quote_id) return;
    
    // Unsubscribe from previous
    if (chatChannel) {
        _supabase.removeChannel(chatChannel);
    }
    
    currentChatQuoteId = quoteId;
    
    // Subscribe to new messages
    chatChannel = _supabase
        .channel(`artist-chat:${quote.quote_id}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `quotation_id=eq.${quote.quote_id}`
        }, async (payload) => {
            // Add message to UI if drawer is open for this quote
            if (currentChatQuoteId === quoteId) {
                const container = document.getElementById('drawer-chat-messages');
                if (container) {
                    const msg = payload.new;
                    const messageEl = document.createElement('div');
                    messageEl.className = `chat-message ${msg.sender_type}`;
                    messageEl.style.cssText = `
                        max-width: 85%;
                        padding: 0.75rem 1rem;
                        margin-bottom: 0.5rem;
                        font-size: 0.85rem;
                        line-height: 1.4;
                        ${msg.sender_type === 'artist' 
                            ? 'align-self: flex-end; background: var(--bauhaus-blue, #1A4B8E); color: white; margin-left: auto;' 
                            : 'align-self: flex-start; background: #f5f5f5; border: 1px solid #ddd;'}
                    `;
                    messageEl.innerHTML = `
                        <div>${escapeHtml(msg.message)}</div>
                        <span style="font-size: 0.65rem; opacity: 0.6; display: block; margin-top: 0.25rem;">
                            ${formatChatTime(msg.created_at)}
                        </span>
                    `;
                    container.appendChild(messageEl);
                    container.scrollTop = container.scrollHeight;
                    
                    // Mark as read if from client
                    if (msg.sender_type === 'client') {
                        await markChatMessagesAsRead(quoteId);
                    }
                }
            }
        })
        .subscribe();
}

// ============================================
// RESPONSE MODAL LOGIC
// ============================================

window.openResponseModal = function(quoteId) {
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote) return;

    // Remove existing modal if any
    const existingModal = document.getElementById('response-modal');
    if (existingModal) existingModal.remove();

    const currentCurrency = quote.artist_budget_currency || quote.client_budget_currency || 'USD';
    const currencies = ['USD', 'EUR', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BRL', 'GBP'];

    const modalHtml = `
        <div id="response-modal" class="modal-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; justify-content: center; align-items: center;">
            <div class="modal-container" style="background: white; padding: 2rem; border-radius: 8px; width: 90%; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h3 style="margin: 0; font-family: 'Space Mono', monospace;">RESPONDER COTIZACION</h3>
                    <button onclick="closeResponseModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">×</button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 1.5rem; font-size: 0.9rem; color: #666;">Confirma tu presupuesto y el numero de sesiones estimadas.</p>
                    
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">TU PRESUPUESTO</label>
                        <div style="display: flex; gap: 0.5rem;">
                            <input type="number" id="response-price" value="${quote.artist_budget_amount || quote.client_budget_amount || ''}" style="flex: 2; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                            <select id="response-currency" style="flex: 1; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px; font-family: 'Space Mono', monospace;">
                                ${currencies.map(c => `<option value="${c}" ${c === currentCurrency ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">SESIONES ESTIMADAS</label>
                        <input type="text" id="response-sessions" value="${quote.tattoo_estimated_sessions || '1'}" placeholder="Ej: 1, 2-3" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; gap: 1rem; justify-content: flex-end;">
                    <button class="action-btn" onclick="closeResponseModal()" style="background: #f5f5f5; color: #333;">CANCELAR</button>
                    <button class="action-btn accept-btn" onclick="submitResponse('${quoteId}')" style="background: var(--bauhaus-blue, #1A4B8E); color: white;">ENVIAR RESPUESTA</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.closeResponseModal = function() {
    const modal = document.getElementById('response-modal');
    if (modal) modal.remove();
};

// ============================================
// CONFIRMATION MODAL LOGIC
// ============================================

window.openConfirmModal = function(quoteId) {
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote) return;

    // Remove existing modal if any
    const existingModal = document.getElementById('confirm-quote-modal');
    if (existingModal) existingModal.remove();

    const clientBudget = quote.client_budget_amount ? `${quote.client_budget_amount} ${quote.client_budget_currency || ''}` : null;
    const artistBudget = quote.artist_budget_amount ? `${quote.artist_budget_amount} ${quote.artist_budget_currency || ''}` : null;
    const currencies = ['USD', 'EUR', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BRL', 'GBP'];
    const defaultCurrency = quote.artist_budget_currency || quote.client_budget_currency || 'USD';

    const modalHtml = `
        <div id="confirm-quote-modal" class="modal-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; justify-content: center; align-items: center;">
            <div class="modal-container" style="background: white; padding: 2rem; border-radius: 8px; width: 90%; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h3 style="margin: 0; font-family: 'Space Mono', monospace;">CONFIRMAR COTIZACION</h3>
                    <button onclick="closeConfirmModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">×</button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 1.5rem; font-size: 0.9rem; color: #666;">Selecciona el presupuesto final aprobado y confirma los detalles.</p>
                    
                    <!-- Budget Selection -->
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">SELECCIONAR PRESUPUESTO</label>
                        <select id="confirm-budget-source" onchange="updateConfirmBudget()" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 0.5rem;">
                            ${clientBudget ? `<option value="client">Presupuesto Cliente: ${clientBudget}</option>` : ''}
                            ${artistBudget ? `<option value="artist">Tu Presupuesto: ${artistBudget}</option>` : ''}
                            <option value="custom">Monto personalizado</option>
                        </select>
                    </div>

                    <!-- Custom Amount -->
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">MONTO FINAL</label>
                        <div style="display: flex; gap: 0.5rem;">
                            <input type="number" id="confirm-amount" value="${quote.artist_budget_amount || quote.client_budget_amount || ''}" style="flex: 2; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                            <select id="confirm-currency" style="flex: 1; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px; font-family: 'Space Mono', monospace;">
                                ${currencies.map(c => `<option value="${c}" ${c === defaultCurrency ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <!-- Sessions -->
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">SESIONES CONFIRMADAS</label>
                        <input type="text" id="confirm-sessions" value="${quote.tattoo_estimated_sessions || '1'}" placeholder="Ej: 1, 2-3" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    
                    <!-- First Session Date -->
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">FECHA PRIMERA SESION *</label>
                        <input type="datetime-local" id="confirm-first-session-date" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;" required>
                        <p style="font-size: 0.7rem; color: #888; margin-top: 0.25rem;">Confirma la fecha y hora de la primera cita</p>
                    </div>
                    
                    <!-- Comment -->
                    <div class="form-group" style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">COMENTARIO (opcional)</label>
                        <textarea id="confirm-comment" rows="3" placeholder="Notas adicionales sobre el acuerdo..." style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px; resize: vertical;"></textarea>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; gap: 1rem; justify-content: flex-end;">
                    <button class="action-btn" onclick="closeConfirmModal()" style="background: #f5f5f5; color: #333;">CANCELAR</button>
                    <button class="action-btn accept-btn" onclick="submitConfirmation('${quoteId}')" style="background: var(--bauhaus-blue, #1A4B8E); color: white;">CONFIRMAR</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Store quote data for updateConfirmBudget
    window._confirmQuoteData = quote;
};

window.updateConfirmBudget = function() {
    const source = document.getElementById('confirm-budget-source').value;
    const amountInput = document.getElementById('confirm-amount');
    const currencySelect = document.getElementById('confirm-currency');
    const quote = window._confirmQuoteData;
    
    if (!quote) return;
    
    if (source === 'client' && quote.client_budget_amount) {
        amountInput.value = quote.client_budget_amount;
        if (quote.client_budget_currency) {
            currencySelect.value = quote.client_budget_currency;
        }
    } else if (source === 'artist' && quote.artist_budget_amount) {
        amountInput.value = quote.artist_budget_amount;
        if (quote.artist_budget_currency) {
            currencySelect.value = quote.artist_budget_currency;
        }
    }
    // For 'custom', leave the current values
};

window.closeConfirmModal = function() {
    const modal = document.getElementById('confirm-quote-modal');
    if (modal) modal.remove();
    window._confirmQuoteData = null;
};

window.submitConfirmation = async function(quoteId) {
    const amount = document.getElementById('confirm-amount').value;
    const currency = document.getElementById('confirm-currency').value;
    const sessions = document.getElementById('confirm-sessions').value;
    const comment = document.getElementById('confirm-comment').value;
    const firstSessionDate = document.getElementById('confirm-first-session-date').value;

    if (!amount) {
        alert('Por favor ingresa el monto final.');
        return;
    }

    if (!firstSessionDate) {
        alert('Por favor selecciona la fecha de la primera sesion.');
        return;
    }

    try {
        const updateData = {
            final_budget_amount: amount,
            final_budget_currency: currency,
            final_sessions: sessions,
            final_comment: comment || null,
            quote_status: 'completed'
        };

        const { error } = await _supabase.from('quotations_db').update(updateData).eq('id', quoteId);
        
        if (error) throw error;

        // Create first session record
        const sessionData = {
            quotation_id: parseInt(quoteId),
            session_number: 1,
            session_date: new Date(firstSessionDate).toISOString(),
            status: 'scheduled',
            notes: comment ? `Nota inicial: ${comment}` : null
        };

        const { error: sessionError } = await _supabase.from('quotation_sessions').insert([sessionData]);
        
        if (sessionError) {
            console.error('Error creating session:', sessionError);
            // Don't fail the whole operation, just log the error
        }

        // Update local state
        const quote = quotations.find(q => q.id.toString() === quoteId.toString());
        if (quote) {
            quote.final_budget_amount = amount;
            quote.final_budget_currency = currency;
            quote.final_sessions = sessions;
            quote.final_comment = comment || null;
            quote.quote_status = 'completed';
        }

        closeConfirmModal();
        
        // Refresh UI
        if (typeof applyFiltersAndSort === 'function') applyFiltersAndSort();
        if (typeof updateStats === 'function') updateStats();
        inspectQuote(quoteId);
        
        alert('Cotizacion confirmada y primera sesion agendada correctamente.');

    } catch (err) {
        console.error('Error confirming quote:', err);
        alert('Error al confirmar: ' + err.message);
    }
};

// ============================================
// EDIT QUOTE MODAL LOGIC
// ============================================

window.openEditQuoteModal = function(quoteId) {
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote) return;

    // Remove existing modal if any
    const existingModal = document.getElementById('edit-quote-modal');
    if (existingModal) existingModal.remove();

    const currentCurrency = quote.artist_budget_currency || quote.client_budget_currency || 'USD';
    const currencies = ['USD', 'EUR', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BRL', 'GBP'];
    
    // Body parts options
    const bodyParts = ['Brazo', 'Antebrazo', 'Hombro', 'Espalda', 'Pecho', 'Costillas', 'Pierna', 'Muslo', 'Pantorrilla', 'Tobillo', 'Pie', 'Mano', 'Cuello', 'Cabeza', 'Otro'];
    
    // Body sides options
    const bodySides = ['Izquierdo', 'Derecho', 'Centro', 'Ambos'];
    
    // Size options
    const sizes = ['Pequeno (< 5cm)', 'Mediano (5-15cm)', 'Grande (15-30cm)', 'Extra Grande (> 30cm)', 'Media manga', 'Manga completa', 'Espalda completa'];
    
    // Color type options
    const colorTypes = ['Solo negro', 'Negro y gris', 'Color', 'Acuarela', 'Mixto'];

    // Get current style name
    const currentStyle = quote.tattoo_style;
    const currentStyleName = typeof currentStyle === 'object' ? (currentStyle?.style_name || '') : (currentStyle || '');

    const modalHtml = `
        <div id="edit-quote-modal" class="modal-overlay" style="display: flex; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; justify-content: center; align-items: center; overflow-y: auto; padding: 1rem;">
            <div class="modal-container" style="background: white; padding: 2rem; border-radius: 8px; width: 90%; max-width: 600px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); max-height: 90vh; overflow-y: auto;">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; position: sticky; top: 0; background: white; padding-bottom: 0.5rem; border-bottom: 2px solid var(--bauhaus-yellow, #F5C518);">
                    <h3 style="margin: 0; font-family: 'Space Mono', monospace;">EDITAR COTIZACION</h3>
                    <button onclick="closeEditQuoteModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer;">×</button>
                </div>
                <div class="modal-body">
                    <!-- Price and Currency -->
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">TU PRESUPUESTO</label>
                        <div style="display: flex; gap: 0.5rem;">
                            <input type="number" id="edit-price" value="${quote.artist_budget_amount || ''}" placeholder="Precio" style="flex: 2; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                            <select id="edit-currency" style="flex: 1; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px; font-family: 'Space Mono', monospace;">
                                ${currencies.map(c => `<option value="${c}" ${c === currentCurrency ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <!-- Sessions -->
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">SESIONES ESTIMADAS</label>
                        <input type="text" id="edit-sessions" value="${quote.tattoo_estimated_sessions || ''}" placeholder="Ej: 1, 2-3" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    
                    <!-- Description -->
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">DESCRIPCION DEL TATUAJE</label>
                        <textarea id="edit-description" rows="4" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${quote.tattoo_idea_description || ''}</textarea>
                    </div>
                    
                    <!-- Body Part and Side -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div class="form-group">
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">PARTE DEL CUERPO</label>
                            <select id="edit-body-part" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                                <option value="">Seleccionar...</option>
                                ${bodyParts.map(p => `<option value="${p}" ${p === quote.tattoo_body_part ? 'selected' : ''}>${p}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">LADO</label>
                            <select id="edit-body-side" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                                <option value="">Seleccionar...</option>
                                ${bodySides.map(s => `<option value="${s}" ${s === quote.tattoo_body_side ? 'selected' : ''}>${s}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    
                    <!-- Style -->
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">ESTILO</label>
                        <input type="text" id="edit-style" value="${currentStyleName}" placeholder="Ej: Realismo, Tradicional, Blackwork..." style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    
                    <!-- Size and Color -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
                        <div class="form-group">
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">TAMANO</label>
                            <select id="edit-size" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                                <option value="">Seleccionar...</option>
                                ${sizes.map(s => `<option value="${s}" ${s === quote.tattoo_size ? 'selected' : ''}>${s}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label style="display: block; margin-bottom: 0.5rem; font-weight: bold; font-size: 0.8rem;">COLOR</label>
                            <select id="edit-color" style="width: 100%; padding: 0.8rem; border: 1px solid #ddd; border-radius: 4px;">
                                <option value="">Seleccionar...</option>
                                ${colorTypes.map(c => `<option value="${c}" ${c === quote.tattoo_color_type ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; gap: 1rem; justify-content: flex-end; position: sticky; bottom: 0; background: white; padding-top: 1rem; border-top: 1px solid #eee;">
                    <button class="action-btn" onclick="closeEditQuoteModal()" style="background: #f5f5f5; color: #333;">CANCELAR</button>
                    <button class="action-btn accept-btn" onclick="saveQuoteEdits('${quoteId}')" style="background: var(--bauhaus-blue, #1A4B8E); color: white;">GUARDAR CAMBIOS</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.closeEditQuoteModal = function() {
    const modal = document.getElementById('edit-quote-modal');
    if (modal) modal.remove();
};

window.saveQuoteEdits = async function(quoteId) {
    const price = document.getElementById('edit-price').value;
    const currency = document.getElementById('edit-currency').value;
    const sessions = document.getElementById('edit-sessions').value;
    const description = document.getElementById('edit-description').value;
    const bodyPart = document.getElementById('edit-body-part').value;
    const bodySide = document.getElementById('edit-body-side').value;
    const style = document.getElementById('edit-style').value;
    const size = document.getElementById('edit-size').value;
    const color = document.getElementById('edit-color').value;

    try {
        const updateData = {
            artist_budget_amount: price || null,
            artist_budget_currency: currency || null,
            tattoo_estimated_sessions: sessions || null,
            tattoo_idea_description: description || null,
            tattoo_body_part: bodyPart || null,
            tattoo_body_side: bodySide || null,
            tattoo_style: style ? { style_name: style } : null,
            tattoo_size: size || null,
            tattoo_color_type: color || null
        };

        const { error } = await _supabase.from('quotations_db').update(updateData).eq('id', quoteId);
        
        if (error) throw error;

        // Update local state
        const quote = quotations.find(q => q.id.toString() === quoteId.toString());
        if (quote) {
            quote.artist_budget_amount = price || null;
            quote.artist_budget_currency = currency || null;
            quote.tattoo_estimated_sessions = sessions || null;
            quote.tattoo_idea_description = description || null;
            quote.tattoo_body_part = bodyPart || null;
            quote.tattoo_body_side = bodySide || null;
            quote.tattoo_style = style ? { style_name: style } : null;
            quote.tattoo_size = size || null;
            quote.tattoo_color_type = color || null;
        }

        closeEditQuoteModal();
        
        // Refresh UI
        if (typeof applyFiltersAndSort === 'function') applyFiltersAndSort();
        inspectQuote(quoteId);
        
        alert('Cambios guardados correctamente.');

    } catch (err) {
        console.error('Error saving quote edits:', err);
        alert('Error al guardar cambios: ' + err.message);
    }
};

window.submitResponse = async function(quoteId) {
    const price = document.getElementById('response-price').value;
    const currency = document.getElementById('response-currency').value;
    const sessions = document.getElementById('response-sessions').value;

    if (!price) {
        alert('Por favor ingresa tu presupuesto.');
        return;
    }

    try {
        const updateData = {
            artist_budget_amount: price,
            artist_budget_currency: currency,
            tattoo_estimated_sessions: sessions,
            quote_status: 'responded',
            artist_responded_at: new Date().toISOString()
        };

        const { error } = await _supabase.from('quotations_db').update(updateData).eq('id', quoteId);
        
        if (error) throw error;

        // Update local state
        const quote = quotations.find(q => q.id.toString() === quoteId.toString());
        if (quote) {
            quote.artist_budget_amount = price;
            quote.artist_budget_currency = currency;
            quote.tattoo_estimated_sessions = sessions;
            quote.quote_status = 'responded';
            quote.artist_responded_at = updateData.artist_responded_at;
        }

        closeResponseModal();
        
        // Refresh UI
        if (typeof applyFiltersAndSort === 'function') applyFiltersAndSort();
        if (typeof updateStats === 'function') updateStats();
        inspectQuote(quoteId);
        
        alert('Respuesta enviada correctamente.');

    } catch (err) {
        console.error('Error submitting response:', err);
        alert('Error al enviar respuesta: ' + err.message);
    }
};

// ============================================
// DRAWER DETAILS - MAIN INSPECT FUNCTION
// ============================================

window.inspectQuote = async function(quoteId, options = {}) {
    if (!quoteId) return;
    
    const quote = quotations.find(q => q.id.toString() === quoteId.toString());
    if (!quote) return;
    const drawerContent = document.getElementById('drawer-content');
    
    await loadNotesForQuote(parseInt(quoteId));
    
    // Load sessions for completed quotes
    await loadSessionsForQuote(parseInt(quoteId));
    
    // Load chat messages and unread count
    const chatMessages = await loadChatMessages(quoteId);
    chatUnreadCount = await getUnreadChatCount(quoteId);
    
    // Mark messages as read when opening drawer
    if (chatUnreadCount > 0) {
        await markChatMessagesAsRead(quoteId);
    }
    
    // Subscribe to chat updates
    subscribeToChatUpdates(quoteId);
    
    const attachments = allAttachments.filter(a => a.quotation_id === quote.quote_id);
    lightboxImages = attachments.map(a => a.google_drive_url);
    
    let imagesHtml = attachments.length > 0 
        ? `<div class="image-grid-4">${attachments.map((a, index) => `
            <div class="ref-thumb" onclick="openLightbox(${index})">
                <img src="${getDriveThumbnail(a.google_drive_url)}" alt="Reference ${index + 1}">
            </div>
        `).join('')}</div>`
        : `<div class="ref-box" style="padding: 2rem; text-align: center; background: #f5f5f5;">NO_ATTACHMENTS</div>`;
    
    const currentPriority = quote.priority || 'medium';
    const isArchived = quote.is_archived === true;
    const readOnly = options.readOnly === true;
    
    let actionButtonsHtml = '';
    if (isArchived) {
        actionButtonsHtml = `
            <div style="margin-top: 2rem; display: flex; gap: 1rem;">
                <button class="action-btn accept-btn" style="flex: 1; padding: 1rem;" onclick="unarchiveSingle('${quote.id}')">Unarchive</button>
                <button class="action-btn archive-btn" style="flex: 1; padding: 1rem;" onclick="deleteSingle('${quote.id}')">Delete</button>
            </div>`;
    } else if (!readOnly) {
        let primaryAction = '';
        if (quote.quote_status === 'pending') {
            primaryAction = `<button class="action-btn accept-btn" style="flex: 1; padding: 1rem;" onclick="openResponseModal('${quote.id}')">RESPONDER</button>`;
        } else if (quote.quote_status === 'responded') {
            primaryAction = `<button class="action-btn accept-btn" style="flex: 1; padding: 1rem;" onclick="openConfirmModal('${quote.id}')">CONFIRMAR</button>`;
        } else if (quote.quote_status === 'client_approved') {
            primaryAction = `<button class="action-btn accept-btn" style="flex: 1; padding: 1rem;" onclick="openConfirmModal('${quote.id}')">CONFIRMAR</button>`;
        } else {
            primaryAction = `<button class="action-btn accept-btn" style="flex: 1; padding: 1rem; opacity: 0.5;" disabled>COMPLETADO</button>`;
        }

        actionButtonsHtml = `
            <div style="margin-top: 2rem; display: flex; gap: 1rem; flex-wrap: wrap;">
                ${primaryAction}
                <button class="action-btn" style="flex: 1; padding: 1rem; background: var(--bauhaus-yellow, #F5C518); color: var(--text-on-light, #1A1A1A);" onclick="openEditQuoteModal('${quote.id}')">EDITAR</button>
                <button class="action-btn archive-btn" style="flex: 1; padding: 1rem;" onclick="bulkArchiveSingle('${quote.id}')">Archive</button>
            </div>`;
    }
    
    drawerContent.innerHTML = `
        <div class="shape-decor"></div>
        <div style="margin-bottom: 2rem;">
            <p style="font-family: 'Space Mono'; font-size: 0.8rem; color: var(--bauhaus-red);">RECORD_ID: ${quote.quote_id || quote.id}</p>
            <div class="status-priority-row">
                <select onchange="updateQuoteStatus('${quote.id}', this.value)" class="status-dropdown" ${readOnly ? 'disabled' : ''}>
                    <option value="pending" ${quote.quote_status === 'pending' ? 'selected' : ''}>PENDING</option>
                    <option value="responded" ${quote.quote_status === 'responded' ? 'selected' : ''}>RESPONDED</option>
                    <option value="client_approved" ${quote.quote_status === 'client_approved' ? 'selected' : ''}>CLIENT APPROVED</option>
                    <option value="client_rejected" ${quote.quote_status === 'client_rejected' ? 'selected' : ''}>CLIENT REJECTED</option>
                    <option value="completed" ${quote.quote_status === 'completed' ? 'selected' : ''}>COMPLETED</option>
                </select>
                <select onchange="updateQuotePriority('${quote.id}', this.value)" class="priority-dropdown priority-${currentPriority}" ${readOnly ? 'disabled' : ''}>
                    <option value="low" ${currentPriority === 'low' ? 'selected' : ''}>BAJA</option>
                    <option value="medium" ${currentPriority === 'medium' ? 'selected' : ''}>MEDIA</option>
                    <option value="high" ${currentPriority === 'high' ? 'selected' : ''}>ALTA</option>
                </select>
            </div>
        </div>
        <h2 style="margin-bottom: 2rem;">Quotation<br>Details</h2>
        <div class="info-grid" style="gap: 2rem 1.5rem; margin-bottom: 2rem;">
            <div class="info-block"><label>Client</label><p>${quote.client_full_name || '-'}</p></div>
            <div class="info-block"><label>Cliente Budget</label><p>${quote.client_budget_amount ? `${quote.client_budget_amount} ${quote.client_budget_currency || ''}` : '-'}</p></div>
            <div class="info-block"><label>Tu Presupuesto</label><p>${quote.artist_budget_amount ? `${quote.artist_budget_amount} ${quote.artist_budget_currency || ''}` : '-'}</p></div>
            <div class="info-block"><label>Sesiones</label><p>${quote.tattoo_estimated_sessions || '-'}</p></div>
            <div class="info-block"><label>Placement</label><p>${quote.tattoo_body_part || '-'}</p></div>
            <div class="info-block"><label>Style</label><p>${getStyleDisplayName(quote.tattoo_style)}</p></div>
            <div class="info-block"><label>Location</label><p>${quote.client_city_residence || '-'}</p></div>
            <div class="info-block"><label>Fecha Deseada</label><p>${quote.client_preferred_date || 'Flexible'}</p></div>
        </div>
        ${quote.final_budget_amount ? `
        <div class="info-block" style="margin-top: 2rem; padding: 1.5rem; background: var(--bauhaus-yellow, #F5C518); border-radius: 4px;">
            <label style="color: var(--text-on-light, #1A1A1A); margin-bottom: 0.75rem;">PRESUPUESTO FINAL APROBADO</label>
            <p style="font-size: 1.25rem; font-weight: bold; color: var(--text-on-light, #1A1A1A); margin-bottom: 0.5rem;">${quote.final_budget_amount} ${quote.final_budget_currency || ''}</p>
            ${quote.final_sessions ? `<p style="font-size: 0.95rem; font-weight: 500; color: var(--text-on-light, #1A1A1A); margin-bottom: 0.5rem;">SESIONES: ${quote.final_sessions}</p>` : ''}
            ${quote.final_comment ? `<p style="font-size: 0.9rem; margin-top: 0.75rem; color: var(--text-on-light, #1A1A1A); font-style: italic;">"${quote.final_comment}"</p>` : ''}
        </div>
        ` : ''}
        ${quote.quote_status === 'completed' ? renderSessionsSection(quote.id, currentQuoteSessions, readOnly) : ''}
        <div class="info-block" style="margin-top: 2.5rem;"><label style="margin-bottom: 0.75rem;">Idea del Tatuaje</label><p style="font-weight: 400; border-left: 4px solid var(--bauhaus-yellow); padding-left: 1rem;">"${quote.tattoo_idea_description || 'No description provided.'}"</p></div>
        
        <button class="action-btn expand-info-btn" onclick="toggleAdditionalQuoteInfo()" id="expand-quote-info-btn" style="width: 100%; margin-top: 2rem; font-family: 'Space Mono', monospace; font-size: 0.75rem;">
            AMPLIAR INFORMACION
        </button>
        
        <div id="additional-quote-info" class="additional-info-section" style="display: none; margin-top: 1.5rem; padding: 1.5rem; background: rgba(0,0,0,0.02); border: 2px dashed var(--ink, #1A1A1A);">
            <div class="info-grid" style="gap: 1.5rem; margin-bottom: 1.5rem;">
                <div class="info-block"><label>Email</label><p>${quote.client_email || '-'}</p></div>
                <div class="info-block"><label>WhatsApp</label><p>${quote.client_whatsapp || '-'}</p></div>
                <div class="info-block"><label>Instagram</label><p>${quote.client_instagram || '-'}</p></div>
                <div class="info-block"><label>Edad</label><p>${quote.client_age || '-'}</p></div>
                <div class="info-block"><label>Dispuesto a Viajar</label><p>${quote.client_travel_willing ? 'Si' : 'No'}</p></div>
                <div class="info-block"><label>Fechas Flexibles</label><p>${quote.client_flexible_dates ? 'Si' : 'No'}</p></div>
            </div>
            <div class="info-block" style="margin-top: 1.5rem;"><label>Alergias</label><p>${quote.client_allergies || 'Ninguna'}</p></div>
            <div class="info-block" style="margin-top: 1rem;"><label>Condiciones de Salud</label><p>${quote.client_health_conditions || 'Ninguna'}</p></div>
            <div class="info-grid" style="margin-top: 1.5rem; gap: 1.5rem;">
                <div class="info-block"><label>Primer Tatuaje</label><p>${quote.tattoo_is_first_tattoo ? 'Si' : 'No'}</p></div>
                <div class="info-block"><label>Es Cover-up</label><p>${quote.tattoo_is_cover_up ? 'Si' : 'No'}</p></div>
                <div class="info-block"><label>Color</label><p>${quote.tattoo_color_type || '-'}</p></div>
                <div class="info-block"><label>Tamano</label><p>${quote.tattoo_size || '-'}</p></div>
            </div>
        </div>
        <div class="info-block" style="margin-top: 3rem;">
            <label style="margin-bottom: 1rem;">Reference Assets (${attachments.length})</label>
            ${imagesHtml}
        </div>
        ${renderNotesSection(quote.id, currentQuoteNotes, readOnly)}
        ${renderChatSection(quoteId, chatMessages, readOnly)}
        ${actionButtonsHtml}`;
    document.getElementById('drawer-toggle').checked = true;
    
    // Scroll chat to bottom after render
    setTimeout(() => {
        const chatContainer = document.getElementById('drawer-chat-messages');
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }, 100);
};

// Archive-specific actions
window.bulkArchiveSingle = window.bulkArchiveSingle || async function(id) {
    if (typeof selectedQuotes !== 'undefined') {
        selectedQuotes.clear();
        selectedQuotes.add(id.toString());
        if (typeof bulkArchive === 'function') await bulkArchive();
    }
    document.getElementById('drawer-toggle').checked = false;
};

window.unarchiveSingle = window.unarchiveSingle || async function(id) {
    try {
        const { error } = await _supabase.from('quotations_db').update({ is_archived: false }).eq('id', id);
        if (error) throw error;
        document.getElementById('drawer-toggle').checked = false;
        if (typeof loadQuotations === 'function') await loadQuotations();
    } catch (err) { alert('Error unarchiving: ' + err.message); }
};

window.deleteSingle = window.deleteSingle || async function(id) {
    if (!confirm('Are you sure you want to permanently delete this quote?')) return;
    try {
        const { error } = await _supabase.from('quotations_db').delete().eq('id', id);
        if (error) throw error;
        document.getElementById('drawer-toggle').checked = false;
        if (typeof loadQuotations === 'function') await loadQuotations();
    } catch (err) { alert('Error deleting: ' + err.message); }
};
