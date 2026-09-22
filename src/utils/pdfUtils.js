import * as pdfjsLib from 'pdfjs-dist';

// Configure worker using CDN to avoid Vite build issues
// Using unpkg to ensure we get the worker matching the installed version
// Fallback to a fixed version if pdfjsLib.version is undefined
const version = pdfjsLib.version || '4.8.69';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

const createPdfLoadingSource = async (pdfSource) => {
    if (pdfSource instanceof Blob) {
        return { data: new Uint8Array(await pdfSource.arrayBuffer()) };
    }

    if (pdfSource instanceof ArrayBuffer) {
        return { data: new Uint8Array(pdfSource) };
    }

    if (ArrayBuffer.isView(pdfSource)) {
        return { data: pdfSource };
    }

    return pdfSource;
};

const describePdfSource = (pdfSource) => {
    if (pdfSource instanceof Blob) return `${pdfSource.type || 'application/pdf'} blob (${pdfSource.size} bytes)`;
    if (pdfSource instanceof ArrayBuffer) return `ArrayBuffer (${pdfSource.byteLength} bytes)`;
    if (ArrayBuffer.isView(pdfSource)) return `${pdfSource.constructor.name} (${pdfSource.byteLength} bytes)`;
    return pdfSource;
};

export const convertPdfToImages = async (pdfUrl, onLog = console.log, onProgress = null, options = {}) => {
    onLog(`Starting PDF conversion for: ${describePdfSource(pdfUrl)}`);
    try {
        const loadingTask = pdfjsLib.getDocument(await createPdfLoadingSource(pdfUrl));
        onLog("Loading PDF document...");
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        onLog(`PDF loaded. Pages: ${numPages}`);

        // Process up to 50 pages by default. AI requests can pass a smaller cap.
        const maxPages = options.maxPages || 50;
        const pagesToProcess = Math.min(numPages, maxPages);
        const images = [];

        const targetScale = typeof options.scale === 'number' ? options.scale : 1.2;
        const targetQuality = typeof options.quality === 'number' ? options.quality : 0.75;

        if (numPages > pagesToProcess) {
            const warnMsg = `[pdfUtils] ⚠️ PDF上限超過警告: 全${numPages}ページ中、${pagesToProcess}ページのみ変換します（${numPages - pagesToProcess}ページがスキップされます。上限: ${maxPages}ページ）。Geminiが後半の内容を読めない可能性があります。`;
            console.warn(warnMsg);
            onLog(warnMsg);
            if (typeof options.onWarning === 'function') {
                options.onWarning(warnMsg, { totalPages: numPages, convertedPages: pagesToProcess, skippedPages: numPages - pagesToProcess, maxPages });
            }
        }

        onLog(`Processing ${pagesToProcess} pages sequentially (scale: ${targetScale}, quality: ${targetQuality})...`);
        if (onProgress) onProgress(0);

        for (let i = 1; i <= pagesToProcess; i++) {
            // Yield to main thread to prevent freezing
            await new Promise(resolve => setTimeout(resolve, 100));

            onLog(`Reading page ${i}...`);
            let page = null;
            let canvas = null;
            try {
                page = await pdf.getPage(i);

                const viewport = page.getViewport({ scale: targetScale });

                canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await Promise.race([
                    page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Page render timeout')), 5000))
                ]);

                // Yield again before heavy toDataURL
                await new Promise(resolve => setTimeout(resolve, 50));

                const base64 = canvas.toDataURL('image/jpeg', targetQuality).split(',')[1];
                images.push({
                    inlineData: {
                        data: base64,
                        mimeType: "image/jpeg"
                    },
                    pageNumber: i
                });
                onLog(`Page ${i} processed.`);
                if (onProgress) {
                    onProgress(Math.round((i / pagesToProcess) * 100));
                }
            } catch (pageError) {
                console.error(`Error rendering page ${i}:`, pageError);
                onLog(`Error rendering page ${i}: ${pageError.message}`);
            } finally {
                if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                }
                if (page?.cleanup) {
                    page.cleanup();
                }
            }
        }

        const totalBase64Length = images.reduce((acc, img) => acc + (img?.inlineData?.data?.length || 0), 0);
        const totalBytesApprox = Math.round(totalBase64Length * 0.75);

        const metadata = {
            totalPages: numPages,
            convertedPages: images.length,
            skippedPages: Math.max(0, numPages - images.length),
            isTruncated: numPages > images.length,
            scale: targetScale,
            quality: targetQuality,
            maxPages,
            totalBytesApprox,
            warning: numPages > images.length
                ? `全${numPages}ページ中${images.length}ページのみ変換されました（${numPages - images.length}ページが上限によりスキップ）`
                : null
        };
        images.metadata = metadata;

        onLog(`PDF conversion complete. ${images.length}/${numPages} pages converted (~${Math.round(totalBytesApprox / 1024)} KB).`);
        if (onProgress) onProgress(100);
        if (pdf?.cleanup) pdf.cleanup();
        if (pdf?.destroy) await pdf.destroy();
        return images;
    } catch (error) {
        console.error("Error converting PDF to images:", error);
        onLog(`Error converting PDF: ${error.message}`);
        throw error;
    }
};

export const convertPdfToImagesWithMeta = async (pdfUrl, onLog = console.log, onProgress = null, options = {}) => {
    const images = await convertPdfToImages(pdfUrl, onLog, onProgress, options);
    return {
        images,
        metadata: images.metadata || {}
    };
};
