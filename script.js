$(function() {
    let maskContext;
    var brushSize = 5; // Default brush size
    const maxBrushSize = 100;
    const minBrushSize = 1;
    let isErasing = false;
    const maskCanvas = $('#maskCanvas');
    var imageHash = "";
    const selectionRect = $('#selection-rectangle');
    const loadedImage = $('#loaded-image');
    const loadedImageData = $('#loaded-image-data');
    let imageObj = null;

    var socket = io('http://127.0.0.1:9199');

    ///////////////////////////
    // ----- Templates ----- //
    ///////////////////////////

    // Function to load the available templates
    function loadTemplates() {
        fetch('/get-templates')
            .then(response => response.json())
            .then(templates => {
                var templateSelect = $('#template-select');
                templateSelect.empty();
                templates.forEach(template => {
                    templateSelect.append(new Option(template.text, template.value));
                });
            })
            .catch(error => console.error('Error loading templates:', error));
    }

    ////////////////////////////////////
    // ----- Progress indicator ----- //
    ////////////////////////////////////

    // Function to update the progress indicator
    function updateProgress(percentage) {
        var radius = 80;
        $('#progress-path').attr('d', describeArc(100, 100, radius, 0, percentage * 3.6));
        $('#progress-text').text(Math.round(percentage) + '%'); // Round the percentage
    }

    // Function to convert polar coordinates to Cartesian coordinates
    function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
        var angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
        return {
            x: centerX + radius * Math.cos(angleInRadians),
            y: centerY + radius * Math.sin(angleInRadians)
        };
    }

    // Function to describe an SVG arc (for the progress indicator)
    function describeArc(x, y, radius, startAngle, endAngle) {
        var start = polarToCartesian(x, y, radius, endAngle);
        var end = polarToCartesian(x, y, radius, startAngle);
        var largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
        var d = [
            "M", start.x, start.y, 
            "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
        ].join(" ");
        return d;        
    }

    /////////////////////////////////
    // ----- Brush indicator ----- //
    /////////////////////////////////

    // Function to update the brush indicator position and size
    function updateBrushIndicator(e) {
        const brushIndicator = $('#brush-indicator');
        const parentRect = $('#mask-section')[0].getBoundingClientRect();
    
        // Calculate the cursor position relative to the mask-section container
        const x = e.clientX - parentRect.left - 2;
        const y = e.clientY - parentRect.top - 2;
    
        // Position the indicator at the cursor coordinates
        brushIndicator.css({
            'left': (x - brushSize / 2) + 'px',
            'top': (y - brushSize / 2) + 'px',
            'width': brushSize + 'px',
            'height': brushSize + 'px',
            'border-radius': '50%', // Ensures it's circular
            'display': 'block'
        });
    }

    // Mouse wheel event on the mask canvas
    $('#maskCanvas').on('wheel', function(e) {
        if (e.originalEvent.deltaY < 0) {
            brushSize = Math.min(brushSize + 1, maxBrushSize);
        } else {
            brushSize = Math.max(brushSize - 1, minBrushSize);
        }
        $('#stroke-size-value').text(brushSize + 'px'); // Update the UI with the new size
        updateBrushSize(brushSize); // Update the brush size

        const rect = maskCanvas[0].getBoundingClientRect();
        const x = e.clientX - rect.left - 2;
        const y = e.clientY - rect.top - 2;
        updateBrushIndicator(e); // Update the brush indicator position
    });

    // Mouse move event on the mask-section container
    $('#mask-section').mousemove(function(e) {
        updateBrushIndicator(e);
    }).mouseleave(function() {
        $('#brush-indicator').hide(); // Hide the indicator when the mouse leaves the container
    });

    ///////////////////////////////////////////
    // ----- Socket.io event listeners ----- //
    ///////////////////////////////////////////

    // Socket.io event listener for progress updates
    socket.on('progress', function(data) {
        updateProgress(data);
    });

    // Socket.io event listener for status updates (called when done)
    socket.on('status', function(data) {
        if(data.status === 'done') {
            updateProgress(100); // Set to 100% when done
            imageHash = data.id;
        }
    });

    ////////////////////////////////
    // ----- Canvas drawing ----- //
    ////////////////////////////////

    // Function to set up the mask canvas
    function setupMaskCanvas(imageWidth, imageHeight) {
        // Initialize both the visible and in-memory canvases
        maskCanvas.prop('width', imageWidth);
        maskCanvas.prop('height', imageHeight);
        maskContext = maskCanvas[0].getContext('2d');
        maskContext.lineWidth = brushSize;
        maskContext.lineCap = 'round';
        maskContext.strokeStyle = '#FFFFFFFF';
    }

    // Function to draw on the mask canvas
    function drawOnCanvas(x, y, erasing) {
        if (erasing) {
            maskContext.globalCompositeOperation = 'destination-out';
        } else {
            maskContext.globalCompositeOperation = 'source-over';
        }

        maskContext.lineTo(x, y);
        maskContext.stroke();
        maskContext.beginPath();
        maskContext.moveTo(x, y);
    }

    // Mouse down events on the mask canvas
    maskCanvas.mousedown(function(e) {
        const rect = maskCanvas[0].getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
    
        maskContext.beginPath();
        drawOnCanvas(x, y, isErasing);
    });

    // Mouse move events on the mask canvas
    maskCanvas.mousemove(function(e) {
        if (e.buttons !== 1) return; // Draw only if the left mouse button is pressed

        const rect = maskCanvas[0].getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        drawOnCanvas(x, y, isErasing);
    });
    
    // Mouse up events on the mask canvas
    maskCanvas.mouseup(function() {
        maskContext.beginPath(); // Begin a new path to stop drawing
    });

    // Mouse leave events on the mask canvas
    maskCanvas.mouseleave(function() {
        maskContext.beginPath(); // Begin a new path to stop drawing
    });

    // Logic for erasing and drawing
    $(document).keydown(function(e) {
        if (e.key === 'Shift' && !isErasing) {
            isErasing = true;
        }
    }).keyup(function(e) {
        if (e.key === 'Shift' && isErasing) {
            isErasing = false;
        }
    });

    ////////////////////////////////
    // ----- Brush Settings ----- //
    ////////////////////////////////

    // Update the brush size and the indicator
    function updateBrushSize(newSize) {
        brushSize = newSize;
        maskContext.lineWidth = newSize;

        // Update the brush size label
        $('#stroke-size-value').text(brushSize + 'px');

        // Update the slider value
        $("#stroke-size-slider").slider('value', brushSize);

        // Update the brush indicator size and position as well
        const brushIndicator = $('#brush-indicator');
        if (brushIndicator.is(':visible')) {
            const pos = brushIndicator.position();
            updateBrushIndicator({
                clientX: pos.left + brushSize / 2 - 2, 
                clientY: pos.top + brushSize / 2 - 2
            });
        }
    }

    ////////////////////////////////
    // ----- UI Interaction ----- //
    ////////////////////////////////

    // Slider for the number of iterations
    $("#iteration-slider").slider({
        value: 50,
        min: 0,
        max: 200,
        slide: function(event, ui) {
            $("#iteration-value").text(ui.value);
        }
    });

    // Slider for the brush size
    $("#stroke-size-slider").slider({
        value: brushSize,
        min: 1,
        max: 100,
        slide: function(event, ui) {
            $("#stroke-size-value").text(ui.value + 'px');
            updateBrushSize(ui.value);
        }
    });

    // Function to update the mask section based on the selection rectangle
    function updateMaskSection() {
        if (!imageObj) return;
    
        const rectPos = selectionRect.position();

        const displaceX = rectPos.left / loadedImageData.width();
        const displaceY = rectPos.top / loadedImageData.height();
    
        // Calculate the position and size of the mask image based on the selection rectangle
        const newLeft = -imageObj.naturalWidth * displaceX;
        const newTop = -imageObj.naturalHeight * displaceY;
    
        $('#mask-image').css({
            'top': newTop + 'px',
            'left': newLeft + 'px',
            'max-width': 'none',
            'max-height': 'none'
        });

        maskCanvas.css({
            'top': newTop + 'px',
            'left': newLeft + 'px',
            'max-width': 'none',
            'max-height': 'none'
        });
    }
    
    // When the selection rectangle is repositioned, update the mask section
    selectionRect.on('stop', updateMaskSection);
    
    // Update the containment of the draggable selection rectangle based on the loaded image
    selectionRect.draggable({
        containment: [
            0, 0, 
            loadedImage.width() - selectionRect.width(), 
            loadedImage.height() - selectionRect.height()
        ],
        drag: updateMaskSection
    });    

    // Load image button
    $("#load-image-btn").change(function() {
        if (this.files && this.files[0]) {
            var reader = new FileReader();
            reader.onload = function(e) {
                imageObj = new Image();
                imageObj.src = e.target.result;
                imageObj.onload = function() {
                    // Calculate the scaling ratio to fit the image within 512x512 pixels
                    const ratio = Math.min(512 / imageObj.width, 512 / imageObj.height);
                    const scaledWidth = imageObj.width * ratio;
                    const scaledHeight = imageObj.height * ratio;

                    setupMaskCanvas(imageObj.naturalWidth, imageObj.naturalHeight); // Set up canvas with actual image dimensions

                    // Update the loaded image container's size
                    loadedImage.css({
                        'background-image': 'url(' + e.target.result + ')'
                    });

                    loadedImageData.css({
                        'top': ((512 - scaledHeight) / 2) + 'px',
                        'left': ((512 - scaledWidth) / 2) + 'px',
                        'width': scaledWidth + 'px',
                        'height': scaledHeight + 'px'
                    });

                    // Set the rectangle size to either 512x512 or the image's size if smaller
                    const rectSize = 512 * Math.max(scaledWidth / imageObj.width, scaledHeight / imageObj.height);
                    selectionRect.css({
                        'width': rectSize + 'px',
                        'height': rectSize + 'px',
                        'top': '0px',
                        'left': '0px'
                    });

                    updateMaskSection();
                    $('#mask-image').attr('src', e.target.result);

                    selectionRect.draggable('option', 'containment', 'parent');
                };
            };
            reader.readAsDataURL(this.files[0]);
        }
    });

    // Clear mask button
    $('#clear-mask-btn').click(function() {
        if (maskContext) {
            maskContext.clearRect(0, 0, maskCanvas.width(), maskCanvas.height());
        }
    });

    // Generate button
    $("#generate-btn").click(function() {
        // Retrieve the src of the updated source image
        var updatedSourceImageUrl = $('#mask-image').attr('src');
    
        // Create a new Image object to load the updated source image
        var updatedSourceImageObj = new Image();
        updatedSourceImageObj.src = updatedSourceImageUrl;
    
        updatedSourceImageObj.onload = function() {
            // Calculate scales based on the updated source image dimensions
            const scaleX = updatedSourceImageObj.width / $('#loaded-image-data').width();
            const scaleY = updatedSourceImageObj.height / $('#loaded-image-data').height();
    
            // Get the position and size of the selection rectangle
            const rectPos = $('#selection-rectangle').position();
            const sourceX = rectPos.left * scaleX;
            const sourceY = rectPos.top * scaleY;
            const rectWidth = $('#selection-rectangle').width() * scaleX;
            const rectHeight = $('#selection-rectangle').height() * scaleY;
        
            // Extracting the image portion from the updated source image
            const imgCanvas = document.createElement('canvas');
            const ctx = imgCanvas.getContext('2d');
            imgCanvas.width = rectWidth;
            imgCanvas.height = rectHeight;
            ctx.drawImage(updatedSourceImageObj, sourceX, sourceY, rectWidth, rectHeight, 0, 0, rectWidth, rectHeight);
            const imageData = imgCanvas.toDataURL('image/png');
        
            // Process the mask canvas as before
            const mskCanvas = document.createElement('canvas');
            const mskCtx = mskCanvas.getContext('2d');
            mskCanvas.width = rectWidth;
            mskCanvas.height = rectHeight;
            mskCtx.drawImage($('#maskCanvas')[0], sourceX, sourceY, rectWidth, rectHeight, 0, 0, rectWidth, rectHeight);
            const maskData = mskCanvas.toDataURL('image/png');
        
            // Get the selected template and prompt text
            var selectedTemplate = $('#template-select').val();
            var promptText = $('#prompt').val();
            var finalPrompt = selectedTemplate + " " + promptText;
    
            // Sending updated data to the server
            const formData = new FormData();
            formData.append('original_image_data', imageData);
            formData.append('mask_data', maskData);
            formData.append('text', finalPrompt);
            formData.append('iterations', $('#iteration-value').text());
        
            fetch('/generate', { method: 'POST', body: formData })
                .then(response => response.blob())
                .then(blob => {
                    var objectURL = URL.createObjectURL(blob);
                    overlayGeneratedImage(objectURL);
                });
        }
    });
    
    // Function to overlay the generated image onto the original image
    function overlayGeneratedImage(generatedImageUrl) {
        const selectionRect = $('#selection-rectangle');
        const loadedImageData = $('#loaded-image-data');
        const generatedImageDiv = $('#generated-image');
        const originalImage = $('#mask-image')[0]; // Original image element

        // Load the generated image
        const generatedImage = new Image();
        generatedImage.src = generatedImageUrl;
        generatedImage.onload = function() {
            // Create a canvas to draw the final image at original resolution
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = originalImage.naturalWidth;
            canvas.height = originalImage.naturalHeight;

            // Draw the original image on the canvas
            ctx.drawImage(originalImage, 0, 0);

            // Calculate selection rectangle coordinates relative to the original image
            const rectX = selectionRect.position().left / loadedImageData.width() * originalImage.naturalWidth;
            const rectY = selectionRect.position().top / loadedImageData.height() * originalImage.naturalHeight;
            const rectWidth = selectionRect.width() / loadedImageData.width() * originalImage.naturalWidth;
            const rectHeight = selectionRect.height() / loadedImageData.height() * originalImage.naturalHeight;

            // Scale the generated image to fit the selection area on the original image
            ctx.drawImage(generatedImage, 0, 0, generatedImage.width, generatedImage.height, rectX, rectY, rectWidth, rectHeight);

            // Convert canvas to image URL for display
            const finalImageUrl = canvas.toDataURL("image/png");
            // Display the final image with retained aspect ratio
            let imageStyle = 'max-width: 100%; max-height: 100%; object-fit: contain;'; // Default style to retain aspect ratio
            generatedImageDiv.html('<img src="' + finalImageUrl + '" alt="Final Image" style="' + imageStyle + '">');


            // Store the full-resolution image for download
            $('#download-btn').data('downloadUrl', finalImageUrl);
        };
    }

    // Download button
    $("#download-btn").click(function() {
        const downloadUrl = $(this).data('downloadUrl');
        if (downloadUrl) {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = imageHash + '.png'; // Set a default download name
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else {
            alert("No image to download!");
        }
    });

    // Copy to source button
    $("#copy-to-source-btn").click(function() {
        // Retrieve the src of the final generated image
        var finalImageSrc = $('#generated-image img').attr('src');

        // Check if the final image exists
        if (finalImageSrc) {
            // Update the background-image of the loaded-image-data
            //$('#loaded-image-data').css('background-image', 'url(' + finalImageSrc + ')');

            var finalImageObj = new Image();
            finalImageObj.src = finalImageSrc;

            const ratio = Math.min(512 / finalImageObj.width, 512 / finalImageObj.height);
            const scaledWidth = finalImageObj.width * ratio;
            const scaledHeight = finalImageObj.height * ratio;

            $('#loaded-image-data').css({
                'background-image': 'url(' + finalImageSrc + ')',
                'background-size': `${scaledWidth}px ${scaledHeight}px`,
                'background-position': 'center',
                'background-repeat': 'no-repeat'
            });

            // Update the src of the mask image
            $('#mask-image').attr('src', finalImageSrc);

            // Optionally, clear or reset the mask canvas if needed
            var maskCanvas = document.getElementById('maskCanvas');
            var maskContext = maskCanvas.getContext('2d');
            maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        } else {
            alert('No generated image to copy.');
        }
    });

    // Function to initialize the UI
    $(document).ready(function() {
        loadTemplates();
    });
});