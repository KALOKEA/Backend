import {
  Controller, Post, UseInterceptors, UploadedFile,
  UseGuards, Query, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { AdminGuard } from '../common/guards/admin.guard';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

@Controller('upload')
export class UploadController {
  constructor(private upload: UploadService) {}

  @UseGuards(AdminGuard)
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new BadRequestException('Only JPEG, PNG or WebP images are allowed'), ok);
      },
    }),
  )
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder = 'products',
  ) {
    if (!file) throw new BadRequestException('No file received — make sure the field name is "file"');
    return this.upload.uploadImage(file, folder);
  }
}
