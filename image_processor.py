"""
image_processor.py
===================

This module provides functionality to process a directory of image files
(JPEG, PNG, JPG, or SVG) to make them suitable for web galleries. It ensures
that raster images are correctly oriented based on their EXIF metadata,
resizes them to fit within a predetermined bounding box while maintaining
aspect ratio, and compresses them to reduce file size. For SVG files it
applies an XML-based optimization to remove unnecessary data such as
comments and descriptive elements. After processing, a summary of file
sizes and memory savings is returned.

The default maximum dimensions and quality settings can be adjusted by
passing different arguments to the ``process_images`` function. The script
can also be executed directly from the command line to process a given
input directory and output the results to a specified output directory.

Usage (as a script)::

    python image_processor.py --input_dir path/to/images --output_dir path/to/processed --max_width 1024 --max_height 1024 --jpeg_quality 85

When run as a script it will print a report showing the original size,
processed size, and savings for each image, along with the total memory
savings achieved.

"""

from __future__ import annotations

import os
import argparse
from dataclasses import dataclass
from typing import List, Tuple

from PIL import Image, ImageOps  # Pillow library for raster image handling

try:
    from scour.scour import scourString, sanitizeOptions  # type: ignore
except Exception:
    scourString = None  # fallback if scour is unavailable
    sanitizeOptions = None  # type: ignore


@dataclass
class ImageProcessingResult:
    """Container for storing individual image processing results."""
    filename: str
    original_size: int
    processed_size: int
    savings: int


def human_readable_size(size: int) -> str:
    """Convert a file size in bytes to a human‑friendly string."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.2f} {unit}" if unit != "B" else f"{size} {unit}"
        size /= 1024
    return f"{size:.2f} TB"


def optimize_svg(svg_content: str) -> str:
    """Optimize SVG content using scour if available.

    This removes comments, unnecessary descriptive elements, and shortens IDs
    to reduce file size without affecting the visual appearance.

    If ``scour`` is not available, the input SVG content is returned
    unchanged.
    """
    if scourString and sanitizeOptions:
        # Create a new options object via sanitizeOptions. Passing no arguments
        # returns a default configuration that we can mutate for optimization.
        options = sanitizeOptions()  # type: ignore
        # Tighten settings for better compression.
        # Remove XML comments, descriptive elements and metadata that are not needed
        # for rendering the SVG. Also shorten IDs to reduce character count.
        options.strip_comments = True
        options.remove_descriptive_elements = True
        options.shorten_ids = True
        options.remove_metadata = True
        # scourString returns a string of optimized SVG content. No need to call getvalue().
        optimized = scourString(svg_content, options)  # type: ignore
        return optimized
    # fallback: return original content
    return svg_content


def process_images(
    input_dir: str,
    output_dir: str,
    max_width: int = 1024,
    max_height: int = 1024,
    jpeg_quality: int = 85,
) -> Tuple[List[ImageProcessingResult], int, int, int]:
    """
    Process images from ``input_dir`` and write optimized versions into ``output_dir``.

    Parameters
    ----------
    input_dir : str
        Path to the directory containing input images.
    output_dir : str
        Path to the directory where processed images will be written. The
        directory will be created if it does not exist.
    max_width : int, optional
        Maximum width of the processed images (default is 1024 pixels).
    max_height : int, optional
        Maximum height of the processed images (default is 1024 pixels).
    jpeg_quality : int, optional
        Quality setting for JPEG images (0–100). Higher values retain
        more quality but result in larger files (default is 85).

    Returns
    -------
    results : List[ImageProcessingResult]
        A list of results for each processed image including original size,
        processed size, and savings.
    total_savings : int
        Total number of bytes saved across all processed images.
    total_original : int
        Sum of original file sizes in bytes.
    total_processed : int
        Sum of processed file sizes in bytes.
    """
    supported_extensions = (".jpg", ".jpeg", ".png", ".svg")
    results: List[ImageProcessingResult] = []
    total_original = 0
    total_processed = 0

    # Ensure the output directory exists
    os.makedirs(output_dir, exist_ok=True)

    for filename in sorted(os.listdir(input_dir)):
        ext = os.path.splitext(filename)[1].lower()
        if ext not in supported_extensions:
            # Skip unsupported file types
            continue
        input_path = os.path.join(input_dir, filename)
        output_path = os.path.join(output_dir, filename)
        if not os.path.isfile(input_path):
            continue

        original_size = os.path.getsize(input_path)
        total_original += original_size
        processed_size = original_size  # default if we do nothing

        try:
            if ext in (".jpg", ".jpeg", ".png"):
                # Open image and correct orientation based on EXIF metadata
                with Image.open(input_path) as img:
                    img = ImageOps.exif_transpose(img)
                    # Resize while maintaining aspect ratio
                    img.thumbnail((max_width, max_height), Image.LANCZOS)
                    # Save using compression settings appropriate for the format
                    if ext in (".jpg", ".jpeg"):
                        img.save(output_path, format="JPEG", quality=jpeg_quality, optimize=True)
                    else:  # PNG
                        # Use optimize flag to reduce file size
                        img.save(output_path, format="PNG", optimize=True)
            elif ext == ".svg":
                # Read SVG content, optimize it, and write out the optimized version
                with open(input_path, "r", encoding="utf-8") as f_in:
                    svg_content = f_in.read()
                optimized_svg = optimize_svg(svg_content)
                with open(output_path, "w", encoding="utf-8") as f_out:
                    f_out.write(optimized_svg)
            # Compute processed size
            processed_size = os.path.getsize(output_path)
        except Exception as e:
            # If an error occurs during processing, we copy the file unchanged
            # to the output directory so that the file is still available
            # and record the failure in the result.
            import shutil

            shutil.copy2(input_path, output_path)
            processed_size = os.path.getsize(output_path)
            print(f"Warning: failed to process '{filename}' due to: {e}. File copied without modification.")

        total_processed += processed_size
        results.append(
            ImageProcessingResult(
                filename=filename,
                original_size=original_size,
                processed_size=processed_size,
                savings=original_size - processed_size,
            )
        )

    total_savings = total_original - total_processed
    return results, total_savings, total_original, total_processed


def print_report(results: List[ImageProcessingResult], total_savings: int, total_original: int, total_processed: int) -> None:
    """Print a formatted report of processing results to the console."""
    if not results:
        print("No supported images found to process.")
        return
    print(f"Processed {len(results)} image(s).\n")
    print(f"{'Filename':<40}{'Original Size':>15}{'Processed Size':>18}{'Savings':>15}")
    print("-" * 88)
    for r in results:
        print(
            f"{r.filename:<40}"
            f"{human_readable_size(r.original_size):>15}"
            f"{human_readable_size(r.processed_size):>18}"
            f"{human_readable_size(r.savings):>15}"
        )
    print("-" * 88)
    print(
        f"{'Total':<40}"
        f"{human_readable_size(total_original):>15}"
        f"{human_readable_size(total_processed):>18}"
        f"{human_readable_size(total_savings):>15}"
    )
    print(f"\nMemory savings: {human_readable_size(total_savings)}\n")


def main() -> None:
    """Entry point for command line usage."""
    parser = argparse.ArgumentParser(
        description=(
            "Process a directory of images to correct orientation, resize to a specified "
            "bounding box, compress file size, and generate a summary report."
        )
    )
    parser.add_argument("--input_dir", required=True, help="Directory containing input images.")
    parser.add_argument("--output_dir", required=True, help="Directory where processed images will be saved.")
    parser.add_argument("--max_width", type=int, default=1024, help="Maximum width of processed images.")
    parser.add_argument("--max_height", type=int, default=1024, help="Maximum height of processed images.")
    parser.add_argument("--jpeg_quality", type=int, default=85, help="JPEG quality (0–100).")
    args = parser.parse_args()

    results, total_savings, total_original, total_processed = process_images(
        args.input_dir,
        args.output_dir,
        max_width=args.max_width,
        max_height=args.max_height,
        jpeg_quality=args.jpeg_quality,
    )
    print_report(results, total_savings, total_original, total_processed)


if __name__ == "__main__":
    main()
