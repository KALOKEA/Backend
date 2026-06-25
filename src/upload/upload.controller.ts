import {
  Controller, Post, UseInterceptors, UploadedFile,
  UseGuards, Query, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

const MAX_SIZE_IMAGE = 5 * 1024 * 1024;   // 5 MB
const MAX_SIZE_MEDIA = 30 * 1024 * 1024;  // 30 MB (covers short videos)

const ALLOWED_FOLDERS = ['products', 'banners', 'categories', 'homepage', 'editorial', 'looks'] as const;
type UploadFolder = (typeof ALLOWED_FOLDERS)[number];

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_MEDIA_TYPES = [...ALLOWED_IMAGE_TYPES, 'video/mp4', 'video/quicktime', 'video/webm'];

/**
 * Verify the first bytes of a buffer match known file signatures (magic bytes).
 * Defends against MIME spoofing: a PHP/exe file sent with Content-Type: image/jpeg
 * will be rejected here even though fileFilter accepted the declared MIME type.
 *
 * Signatures checked:
 *   JPEG: FF D8 FF
 *   PNG:  89 50 4E 47
 *   WebP: 52 49 46 46 .. .. .. .. 57 45 42 50
 *   MP4:  ftyp at offset 4 (bytes 4–7 = 66 74 79 70)
 *   MOV:  ftyp at offset 4 (same box structure as MP4)
 *   WebM: 1A 45 DF A3
 */
function checkMagicBytes(buf: Buffer, mimetype: string): boolean {
  if (!buf || buf.length < 12) return false;

  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  // WebP: "RIFF" + 4 bytes + "WEBP"
  const isWebp =
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  // MP4/MOV: bytes 4-7 == "ftyp"
  const isMp4 =
    buf.length >= 8 &&
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
  // WebM: EBML magic
  const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;

  switch (mimetype) {
    case 'image/jpeg':
    case 'image/jpg':
      return isJpeg;
    case 'image/png':
      return isPng;
    case 'image/webp':
      return isWebp;
    case 'video/mp4':
    case 'video/quicktime':
      return isMp4;
    case 'video/webm':
      return isWebm;
    default:
      return false;
  }
}

@ApiTags('upload')
@ApiBearerAuth('access-token')
@Controller('upload')
export class UploadController {
  constructor(private upload: UploadService) {}

  /** Admin-only: product / banner images. */
  @UseGuards(PermissionsGuard)
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE_IMAGE },
      fileFilter: (_req, file, cb) => {
        const ok = ALLOWED_IMAGE_TYPES.includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only JPEG, PNG or WebP images are allowed'), ok);
      },
    }),
  )
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') rawFolder = 'products',
  ) {
    if (!file) throw new BadRequestException('No file received — field name must be "file"');
    // Secondary defense: verify magic bytes match declared MIME type (SEC-MIME-2).
    if (!checkMagicBytes(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        'File content does not match the declared image type. Upload a real JPEG, PNG or WebP.',
      );
    }
    const folder: UploadFolder = ALLOWED_FOLDERS.includes(rawFolder as UploadFolder)
      ? (rawFolder as UploadFolder)
      : 'products';
    return this.upload.uploadImage(file, folder);
  }

  /**
   * Admin-only: upload image OR video for homepage/editorial/hero content.
   * Accepts JPEG, PNG, WebP, MP4, MOV, WebM (max 100 MB for videos).
   */
  @UseGuards(PermissionsGuard)
  @Post('admin-media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
      fileFilter: (_req, file, cb) => {
        const ok = ALLOWED_MEDIA_TYPES.includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only images (JPEG/PNG/WebP) or videos (MP4/MOV/WebM) are allowed'), ok);
      },
    }),
  )
  uploadAdminMedia(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') rawFolder = 'homepage',
  ) {
    if (!file) throw new BadRequestException('No file received — field name must be "file"');
    if (!checkMagicBytes(file.buffer, file.mimetype)) {
      throw new BadRequestException('File content does not match declared type.');
    }
    const folder: UploadFolder = ALLOWED_FOLDERS.includes(rawFolder as UploadFolder)
      ? (rawFolder as UploadFolder)
      : 'homepage';
    return this.upload.uploadMedia(file, folder);
  }

  /**
   * Any authenticated user: upload a photo or short video to attach to a review.
   * Accepts JPEG, PNG, WebP, MP4, MOV, WebM (max 30 MB).
   */
  @Post('review-media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE_MEDIA },
      fileFilter: (_req, file, cb) => {
        const ok = ALLOWED_MEDIA_TYPES.includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only images (JPEG/PNG/WebP) or short videos (MP4/MOV/WebM) are allowed'), ok);
      },
    }),
  )
  uploadReviewMedia(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received — field name must be "file"');
    // Secondary defense: verify magic bytes match declared MIME type.
    if (!checkMagicBytes(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        'File content does not match the declared type. Upload a genuine image or video file.',
      );
    }
    return this.upload.uploadMedia(file, 'reviews');
  }
}
