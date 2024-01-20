#!/usr/bin/env python3

from flask import Flask, send_file, request, send_from_directory, jsonify
from flask_cors import CORS, cross_origin
from flask_socketio import SocketIO
from PIL import Image
from io import BytesIO
import hashlib
import base64
from PIL import Image
import io

from diffusers import AutoPipelineForInpainting, DEISMultistepScheduler
import torch

model_id = 'lykon/dreamshaper-8-inpainting'
iterations = 0

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

def hash_image(image):
    image_bytes = image.tobytes()
    return hashlib.sha256(image_bytes).hexdigest()

@socketio.on('connect')
def client_connected():
    print('Client connected')

@socketio.on('disconnect')
def client_disconnected():
    print('Client disconnected')

def initialize():
    global scheduler
    global pipe
    global cmpl

    print("Loading model")
    pipe = AutoPipelineForInpainting.from_pretrained(model_id, safety_checker=None, torch_dtype=torch.float16, variant="fp16")
    pipe.scheduler = DEISMultistepScheduler.from_config(pipe.scheduler.config)
    pipe = pipe.to("cuda")

initialize()

def serve_pil_image(pil_img):
    img_io = BytesIO()
    pil_img.save(img_io, 'PNG')
    img_io.seek(0)
    return send_file(img_io, mimetype='image/png')

@app.route('/')
def root():
    return send_from_directory('.', 'inpaint_frontend.html')

@app.route('/style.css')
def css():
    return send_from_directory('.', 'style.css')

@app.route('/script.js')
def js():
    return send_from_directory('.', 'script.js')

@app.route('/get-templates')
def get_templates():
    templates = [
        {"value": "", "text": "None"},
        {"value": "(Professional photography, bokeh, natural lighting, canon lens, shot on dslr 64 megapixels sharp focus)", "text": "Photo"},
        {"value": "(by artist 'anime', Anime Key Visual, Japanese Manga, Pixiv, Zerochan, Anime art, Fantia)", "text": "Anime v2"},
        {"value": "(intricate details, HDR, beautifully shot, hyperrealistic, sharp focus, 64 megapixels, perfect composition, high contrast, cinematic, atmospheric, moody)", "text": "Striking"},
        {"value": "(graffiti art, splash art, street art, spray paint, oil gouache melting, acrylic, high contrast, colorful polychromatic, ultra detailed, ultra quality, CGSociety)", "text": "Vibrant"},
        {"value": "(Close-up portrait, color portrait, Linkedin profile picture, professional portrait photography by Martin Schoeller, by Mark Mann, by Steve McCurry, bokeh, studio lighting, canon lens, shot on dslr, 64 megapixels, sharp focus)", "text": "Color Portrait"},
        {"value": "(Mark Brooks and Dan Mumford, comic book art, perfect, smooth)", "text": "Modern Comic"}
    ]
    return jsonify(templates)

def progress(step, timestep, latents):
    global iterations
    socketio.emit('progress', (step / iterations) * 100)

@app.route('/generate/', methods=['GET', 'POST'])
@cross_origin()
def serve_img():
    if request.method == 'POST':
        # Extract text, iteration count, and images from the request
        text = request.form.get('text')
        global iterations
        iterations = int(request.form.get('iterations'))

        # Decode the selected portion of the original image
        orig_img_data = request.form.get('original_image_data')
        _, encoded_orig_img = orig_img_data.split(",", 1)
        orig_img_bytes = base64.b64decode(encoded_orig_img)
        img_orig = Image.open(io.BytesIO(orig_img_bytes)).convert("RGB")

        # Decode and process the mask data
        mask_data = request.form.get('mask_data')
        _, encoded_mask = mask_data.split(",", 1)
        mask_bytes = base64.b64decode(encoded_mask)
        img_mask = Image.open(io.BytesIO(mask_bytes)).convert("L")  # Convert to grayscale

        # Resize images if necessary
        expected_size = (512, 512)  # Expected size for processing
        if img_orig.size != expected_size:
            img_orig = img_orig.resize(expected_size)
        if img_mask.size != expected_size:
            img_mask = img_mask.resize(expected_size)

        # Convert mask to binary (black & white)
        img_mask_bw = img_mask.point(lambda x: 0 if x < 128 else 255, '1')

        # Emit status to the client
        socketio.emit('status', {'status': 'generating'})

        # Generate the image with the model
        generated_image = pipe(
            prompt=text,
            image=img_orig,
            mask_image=img_mask_bw,
            num_inference_steps=iterations,
            callback=progress,
            callback_steps=1
        ).images[0]

        # Convert mask to a format suitable for compositing (mode "1" is binary: black or white)
        # White areas (255) are the parts to keep from the generated image
        mask_for_composite = img_mask_bw.point(lambda x: 255 if x else 0, '1')

        # Apply the generated content onto the original image using the mask
        final_image = Image.composite(generated_image, img_orig, mask_for_composite)

        # Generate a hash for the final image
        image_hash = hash_image(final_image)

        # Emit completion status to the client
        socketio.emit('status', {'status': 'done', 'id': image_hash})

        # Serve the final combined image
        return serve_pil_image(final_image)

if __name__ == "__main__":
    print("Serve")
    app.run(debug=False, port=9199, host="0.0.0.0")
