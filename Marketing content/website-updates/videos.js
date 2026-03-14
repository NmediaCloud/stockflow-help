// ============================================
// videos.js - PERFORMANCE OPTIMIZED
// - Uniform 16:9 containers (same height)
// - Original aspect ratios preserved inside (object-contain)
// - NO video previews on hover (images only)
// - Fast loading with optimized thumbnails
// - Collection-level deep linking (?collection=)
// ============================================
let allVideos = [];
let filteredVideos = [];
let displayedVideos = [];
let currentVideo = null;
let currentLoadIndex = 0;
let categories = new Set();
let subcategories = {};
let subs = {};
let selectedCategory = null;
let selectedSubcategory = null;
let selectedSub = null;
let selectedFormat = 'all';
// --- NEW: TIER 1 DYNAMIC FORMAT TRACKER ---
let currentAssetFormat = 'All';
// Automatically builds the buttons based on your Google Sheet Data
function generateAssetFormatBar() {
    const container = document.getElementById('assetsFormatBar');
    if (!container) return;
    // 1. Extract unique formats, preserving EXACT sheet casing
    const formatsMap = new Map();
    allVideos.forEach(video => {
        if (video.assetFormat && video.assetFormat.trim() !== "") {
            const rawString = video.assetFormat.trim();
            const lowerKey = rawString.toLowerCase();

            // This prevents duplicate buttons (Mp4 vs mp4) but keeps your exact casing
            if (!formatsMap.has(lowerKey)) {
                formatsMap.set(lowerKey, rawString);
            }
        }
    });
    // 2. Convert to array and sort alphabetically
    const sortedFormats = Array.from(formatsMap.values()).sort();
    // 3. Build the HTML string
    let html = `<button onclick="filterByAssetFormat('All')" data-format="All" class="asset-format-btn active border border-orange-500 text-orange-500 bg-black/40 px-4 py-2 rounded transition-colors cursor-pointer">All Assets</button>`;
    // 4. Add the dynamic buttons exactly as they appear in the sheet
    sortedFormats.forEach(fmt => {
        html += `<button onclick="filterByAssetFormat('${fmt}')" data-format="${fmt}" class="asset-format-btn border border-gray-700 text-gray-400 bg-black/40 px-4 py-2 rounded hover:text-white hover:border-gray-500 transition-colors cursor-pointer">${fmt}</button>`;
    });
    // 5. Inject into the page
    container.innerHTML = html;
}
// Handles the click and highlighting
function filterByAssetFormat(format) {
    currentAssetFormat = format;

    document.querySelectorAll('.asset-format-btn').forEach(btn => {
        if (btn.getAttribute('data-format') === format) {
            btn.classList.add('active', 'border-orange-500', 'text-orange-500');
            btn.classList.remove('border-gray-700', 'text-gray-400');
        } else {
            btn.classList.remove('active', 'border-orange-500', 'text-orange-500');
            btn.classList.add('border-gray-700', 'text-gray-400');
        }
    });
    // CRITICAL FIX: Directly call your master rendering function!
    filterVideos();
}
// ===============================
async function init() {
    console.log('🎬 Initializing Stockflow...');

    document.getElementById('status-text').innerHTML =
        '<span class="inline-block w-2 h-2 bg-teal-500 rounded-full animate-pulse mr-2"></span>Loading content...';

    try {
        await loadVideosFromSheet();

        allVideos.sort((a, b) => {
            if (a.featured && !b.featured) return -1;
            if (!a.featured && b.featured) return 1;
            return a.id.localeCompare(b.id);
        });

        buildCategoryButtons();
        generateAssetFormatBar();
        filterVideos();
        // --- DEEP LINKING: CATEGORIES, SUBCATEGORIES, COLLECTIONS & VIDEOS ---
        const urlParams = new URLSearchParams(window.location.search);
        const catToOpen = urlParams.get('cat');
        const subToOpen = urlParams.get('sub');
        const collectionToOpen = urlParams.get('collection');
        const videoIdToOpen = urlParams.get('v');

        // 1. Handle Category/Subcategory Deep Links
       if (catToOpen) {
            console.log("🔗 Category Deep Link:", catToOpen);
            selectedCategory = catToOpen;
            if (subToOpen) selectedSubcategory = subToOpen;

            // Re-build buttons to show the correct sub-row
            buildCategoryButtons();

            // Find the category button and click it safely
            const catBtn = Array.from(document.querySelectorAll('.category-btn')).find(b => b.textContent.trim() === catToOpen.trim());
            if (catBtn) {
                selectCategory(catToOpen, { currentTarget: catBtn });
            }

            if (subToOpen) {
                // Find the subcategory button using .trim() to ignore accidental spaces
                const subBtn = Array.from(document.querySelectorAll('.subcategory-btn')).find(b => b.textContent.trim() === subToOpen.trim());

                // Run IMMEDIATELY (no timeout) so the URL and videos don't break.
                // Pass the subBtn if found for the highlight, or null as a safe fallback.
                selectSubcategory(subToOpen, subBtn ? { currentTarget: subBtn } : null);
            }

            // 1b. Handle Collection Deep Links (third level)
            if (collectionToOpen) {
                console.log("🔗 Collection Deep Link:", collectionToOpen);
                const collBtn = Array.from(document.querySelectorAll('.sub-btn')).find(b => b.textContent.trim() === collectionToOpen.trim());
                selectSub(collectionToOpen, collBtn ? { currentTarget: collBtn } : null);
            }
        }
        // 2. Handle Individual Video Deep Links
        if (videoIdToOpen) {
            const targetVideo = allVideos.find(v => v.id == videoIdToOpen);
            if (targetVideo) {
                console.log("🔗 Video Deep Link: Auto-opening", targetVideo.title);
                setTimeout(() => openModal(targetVideo), 800);
            }
        }
        const featuredCount = allVideos.filter(v => v.featured).length;
        console.log(`✅ Loaded ${allVideos.length} Assets (${featuredCount} featured)`);

    } catch (error) {
        console.error('❌ Init error:', error);
        document.getElementById('status-text').innerHTML =
            `<span class="text-red-500 flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> Error loading Assets. Please refresh the page.</span>`;
        document.getElementById('video-grid').innerHTML = `
            <div class="col-span-full bg-red-50 p-8 rounded-xl">
                <h3 class="text-red-800 font-bold text-xl mb-3">Error Loading Assets</h3>
                <p class="text-red-600 mb-3">${error.message}</p>
                <p class="text-sm text-gray-600">Check browser console (F12) for details.</p>
            </div>
        `;
    }
}
async function loadVideosFromSheet() {
    allVideos = [];
    const csvUrl = CONFIG.SHEET_CSV_URL;

    console.log('📡 Fetching from:', csvUrl);

    try {
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error('Failed to fetch sheet: HTTP ' + response.status);

        const csvText = await response.text();
        console.log('📄 CSV received, length:', csvText.length);

        if (!csvText || csvText.trim().length === 0) {
            throw new Error('Sheet returned empty data');
        }

        const rows = parseCSV(csvText);
        console.log('📊 Parsed rows:', rows.length);

        if (rows.length < 2) {
            throw new Error('Sheet has no data rows');
        }

        console.log('📋 Column count:', rows[0].length);

        const hasFeaturedColumn = rows[0].length >= 15;
        console.log('⭐ Has Featured column:', hasFeaturedColumn);

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const hrFileName = (row[12] || '').toString().trim();
            const formatMatch = hrFileName.match(/_([^_]+)_\.[a-z0-9]+$/i);
            const technicalExtension = formatMatch ? formatMatch[1] : "";

            const video = {
                id: (row[0] || '').toString().trim(),
                title: (row[1] || '').toString().trim(),
                category: (row[2] || '').toString().trim(),
                subcategory: (row[3] || '').toString().trim(),
                sub: (row[4] || '').toString().trim(),
                description: (row[5] || '').toString().trim(),
                thumbnail: (row[6] || '').toString().trim(),
                preview: (row[7] || '').toString().trim(),
                price: parseFloat(row[8]) || 1,
                format: (row[9] || '16:9').toString().trim(),
                resolution: (row[10] || '').toString().trim(),
                tags: (row[11] || '').toString().trim(),
                highResUrl: (row[13] || '').toString().trim(),
                featured: hasFeaturedColumn ? (row[14] === 'TRUE' || row[14] === 'true' || row[14] === true) : false,
                fileFormat: technicalExtension,
                assetFormat: (row[20] || '').toString().trim()
            };

            if (video.id && video.title && video.thumbnail && video.preview) {
                allVideos.push(video);

                if (video.category) {
                    categories.add(video.category);

                    if (!subcategories[video.category]) {
                        subcategories[video.category] = new Set();
                    }
                    if (video.subcategory) {
                        subcategories[video.category].add(video.subcategory);
                    }

                    const catSubKey = `${video.category}|${video.subcategory}`;
                    if (!subs[catSubKey]) {
                        subs[catSubKey] = new Set();
                    }
                    if (video.sub) {
                        subs[catSubKey].add(video.sub);
                    }
                }
            }
        }

        if (allVideos.length === 0) {
            throw new Error('No valid Assets found in sheet');
        }

        console.log(`✅ Successfully loaded ${allVideos.length} Assets`);

    } catch (error) {
        console.error('❌ Error loading Assets:', error);
        throw error;
    }
}
function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                currentCell += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if ((char === '\n' || char === '\r') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            if (currentCell || currentRow.length > 0) {
                currentRow.push(currentCell.trim());
                rows.push(currentRow);
                currentRow = [];
                currentCell = '';
            }
        } else {
            currentCell += char;
        }
    }

    if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
    }

    return rows;
}
function buildCategoryButtons() {
    const container = document.getElementById('categoryButtons');
    container.innerHTML = '';

    const featuredCount = allVideos.filter(v => v.featured).length;

    if (featuredCount > 0) {
        const featuredBtn = document.createElement('button');
        featuredBtn.className = 'category-btn active px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm';

        // UPGRADED FEATURED STAR SVG
        featuredBtn.innerHTML = `<span class="flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-orange-500"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09l2.846.813-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.428-1.428L13.5 18.75l1.178-.394a2.25 2.25 0 001.428-1.428l.394-1.183.394 1.183a2.25 2.25 0 001.428 1.428l1.178.394-1.178.394a2.25 2.25 0 00-1.428 1.428z" /></svg> Featured</span>`;

        featuredBtn.onclick = (e) => selectCategory(null, e);
        container.appendChild(featuredBtn);
    } else {
        const allBtn = document.createElement('button');
        allBtn.className = 'category-btn active px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm';
        allBtn.textContent = 'All Videos';
        allBtn.onclick = (e) => selectCategory(null, e);
        container.appendChild(allBtn);
    }

    const sortedCategories = Array.from(categories).sort();
    sortedCategories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'category-btn px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm';
        btn.textContent = cat;
        btn.onclick = (e) => selectCategory(cat, e);

        container.appendChild(btn);
    });
}
function selectCategory(category, e) {
    const newUrl = new URL(window.location.href);
    if (category) {
        newUrl.searchParams.set('cat', category);
        newUrl.searchParams.delete('sub');
        newUrl.searchParams.delete('collection');
    } else {
        newUrl.searchParams.delete('cat');
        newUrl.searchParams.delete('sub');
        newUrl.searchParams.delete('collection');
    }
    window.history.pushState({}, '', newUrl);
    selectedCategory = category;
    selectedSubcategory = null;
    selectedSub = null;
    document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));

    const evt = e || window.event;
    if (evt && (evt.currentTarget || evt.target)) {
        const targetBtn = evt.currentTarget || evt.target;
        targetBtn.classList.add('active');
    }

    const subSection = document.getElementById('subcategorySection');
    const subSubSection = document.getElementById('subSection');

    if (category === null) {
        if (subSection) subSection.classList.add('hidden');
        if (subSubSection) subSubSection.classList.add('hidden');
    } else if (subcategories[category] && subcategories[category].size > 0) {
        buildSubcategoryButtons(category);
        if (subSection) subSection.classList.remove('hidden');
    } else {
        if (subSection) subSection.classList.add('hidden');
    }

    if (subSubSection) {
        subSubSection.classList.add('hidden');
    }

    filterVideos();
}
function buildSubcategoryButtons(category) {
    const container = document.getElementById('subcategoryButtons');
    const title = document.getElementById('subcategoryTitle');

    container.innerHTML = '';
    title.textContent = `${category} Types`;

    const sortedSubs = Array.from(subcategories[category]).sort();
    sortedSubs.forEach(sub => {
        const count = allVideos.filter(v => v.category === category && v.subcategory === sub).length;

        const btn = document.createElement('button');
        btn.className = 'subcategory-btn px-3 py-1.5 rounded-lg text-xs font-medium transition shadow-sm';
        btn.textContent = `${sub} (${count})`;
        btn.onclick = (e) => selectSubcategory(sub, e);

        container.appendChild(btn);
    });
}
function selectSubcategory(subcategory, e) {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('sub', subcategory);
    newUrl.searchParams.delete('collection');
    window.history.pushState({}, '', newUrl);

    selectedSubcategory = subcategory;
    selectedSub = null;
    document.querySelectorAll('.subcategory-btn').forEach(btn => btn.classList.remove('active'));

    const evt = e || window.event;
    if (evt && (evt.currentTarget || evt.target)) {
        const targetBtn = evt.currentTarget || evt.target;
        targetBtn.classList.add('active');
    }

    const catSubKey = `${selectedCategory}|${subcategory}`;
    const subSection = document.getElementById('subSection');

    if (subs[catSubKey] && subs[catSubKey].size > 0) {
        buildSubButtons(catSubKey);
        subSection.classList.remove('hidden');
    } else {
        subSection.classList.add('hidden');
    }

    filterVideos();
}
function buildSubButtons(catSubKey) {
    const container = document.getElementById('subButtons');
    if (!container) return;

    container.innerHTML = '';

    const sortedSubs = Array.from(subs[catSubKey]).sort();
    sortedSubs.forEach(sub => {
        const btn = document.createElement('button');
        btn.className = 'sub-btn px-3 py-1.5 rounded-lg text-xs font-medium transition shadow-sm bg-black/40 text-gray-400 border border-gray-700 hover:text-white';
        btn.textContent = sub;
        btn.onclick = (e) => selectSub(sub, e);
        container.appendChild(btn);
    });
}
function selectSub(sub, e) {
    selectedSub = sub;

    // Update URL with collection parameter for deep linking
    const newUrl = new URL(window.location.href);
    if (sub) {
        newUrl.searchParams.set('collection', sub);
    } else {
        newUrl.searchParams.delete('collection');
    }
    window.history.pushState({}, '', newUrl);

    document.querySelectorAll('.sub-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    const evt = e || window.event;
    if (evt && (evt.currentTarget || evt.target)) {
        const targetBtn = evt.currentTarget || evt.target;
        targetBtn.classList.add('active');
    }

    filterVideos();
}
function filterVideos() {
    const searchTerm = document.getElementById('searchInput')?.value?.toLowerCase() || '';

    filteredVideos = allVideos.filter(video => {
        if (selectedCategory === null) {
            const hasFeatured = allVideos.some(v => v.featured);
            if (hasFeatured && !video.featured) return false;
        }

        if (selectedCategory !== null && video.category !== selectedCategory) return false;
        if (selectedSubcategory && video.subcategory !== selectedSubcategory) return false;
        if (selectedSub && video.sub !== selectedSub) return false;
        if (selectedFormat !== 'all' && video.format !== selectedFormat) return false;

        if (currentAssetFormat !== 'All' && (!video.assetFormat || video.assetFormat.toUpperCase() !== currentAssetFormat.toUpperCase())) return false;

        if (searchTerm) {
            const searchableText = `${video.title} ${video.description} ${video.tags} ${video.category} ${video.subcategory} ${video.sub}`.toLowerCase();
            if (!searchableText.includes(searchTerm)) return false;
        }

        return true;
    });

    currentLoadIndex = 0;
    displayedVideos = [];
    document.getElementById('video-grid').innerHTML = '';

    loadMore();

    document.getElementById('resultCount').textContent = `${filteredVideos.length} Assets`;

    const statusEl = document.getElementById('status-text');
    if (filteredVideos.length === 0) {
        statusEl.innerHTML = `<span class="text-gray-400 flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" /></svg> No Assets match your filters</span>`;
    } else {
        // THE FIX: Removed the duplicate } else { that was right here!
        statusEl.innerHTML = `<span class="inline-block w-2 h-2 bg-teal-500 rounded-full mr-2"></span>${displayedVideos.length} of ${filteredVideos.length} assets loaded`;
    }
}
function filterByFormat(format, e) {
    selectedFormat = format;

    document.querySelectorAll('.format-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    const evt = e || window.event;
    if (evt && (evt.currentTarget || evt.target)) {
        const targetBtn = evt.currentTarget || evt.target;
        targetBtn.classList.add('active');
    }

    filterVideos();
}
function loadMore() {
    const grid = document.getElementById('video-grid');
    const loadMoreBtn = document.getElementById('loadMoreSection');

    const endIndex = Math.min(currentLoadIndex + CONFIG.ITEMS_PER_LOAD, filteredVideos.length);
    const videosToLoad = filteredVideos.slice(currentLoadIndex, endIndex);

    videosToLoad.forEach(video => {
        const card = createVideoCard(video);
        grid.appendChild(card);
        displayedVideos.push(video);
    });

    currentLoadIndex = endIndex;

    if (currentLoadIndex < filteredVideos.length) {
        loadMoreBtn.classList.remove('hidden');
    } else {
        loadMoreBtn.classList.add('hidden');
    }

    document.getElementById('status-text').innerHTML =
        `<span class="inline-block w-2 h-2 bg-teal-500 rounded-full mr-2"></span>${displayedVideos.length} of ${filteredVideos.length} Assets loaded`;
}
function createVideoCard(video) {
    const card = document.createElement('div');
    card.className = 'group cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-2xl rounded-xl overflow-hidden bg-white border border-gray-200';
    card.onclick = () => openModal(video);
    const formatBadge = {
        '9:16': `<span class="flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg> 9:16</span>`,

        '1:1': `<span class="flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25h13.5v13.5H5.25V5.25Z" /></svg> 1:1</span>`,

        '16:9': `<span class="flex items-center gap-1.5"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" /></svg> 16:9</span>`
    }[video.format] || video.format;
    const extensionTag = video.fileFormat
        ? `<span class="ml-2 bg-gray-700 text-white px-1.5 py-0.5 rounded text-[10px] border border-gray-600">${video.fileFormat}</span>`
        : "";
    card.innerHTML = `
        <div class="relative overflow-hidden aspect-video bg-gray-900">
            <span class="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded-md text-xs font-medium">${formatBadge}</span>
            <img src="${video.thumbnail}" alt="${video.title}" class="w-full h-full object-contain transition-transform duration-300 group-hover:scale-110" loading="lazy">
            <div class="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div class="bg-white/95 p-4 rounded-full shadow-xl">
                    <svg class="w-8 h-8 text-teal-500 ml-1" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"></path>
                    </svg>
                </div>
            </div>
        </div>
        <div class="p-4">
            <h3 class="font-bold text-gray-900 text-sm mb-1 line-clamp-2 group-hover:text-teal-600 transition">${video.title}</h3>
            <p class="text-xs text-gray-500 mb-2">${video.category} • ${video.subcategory || ''}</p>
            <div class="flex items-center justify-between">
                <span class="text-teal-600 font-bold text-lg">$${video.price}</span>
                <div class="flex items-center">
                    <span class="text-xs text-gray-400">${video.resolution || 'HD'}</span>
                    ${extensionTag}
                </div>
            </div>
        </div>
    `;
    return card;
}
window.init = init;
window.filterVideos = filterVideos;
window.filterByFormat = filterByFormat;
window.loadMore = loadMore;
// --- MODAL TRIGGER ---
function openModal(video) {
    window.currentVideo = video;
    if (typeof window.showPreviewModal === 'function') {
        window.showPreviewModal(video);
    } else {
        console.log("Opening modal for:", video.title, "Format:", video.fileFormat);
    }
}
window.openModal = openModal;
// ---- NOTIFICATION SYSTEM ----
function showNotification(message, type = 'success') {
    const toast = document.getElementById('notification');
    const msgEl = document.getElementById('notificationMessage');

    if (!toast || !msgEl) {
        console.log(`Notification (${type}): ${message}`);
        return;
    }
    msgEl.textContent = message;

    if (type === 'error') {
        toast.style.backgroundColor = '#EF4444';
    } else if (type === 'info') {
        toast.style.backgroundColor = '#3B82F6';
    } else {
        toast.style.backgroundColor = '#F97316';
    }
    toast.style.display = 'block';
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.style.display = 'none';
        toast.classList.add('hidden');
    }, 4000);
}
window.showNotification = showNotification;
