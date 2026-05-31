import { Controller, Post, UseInterceptors, UploadedFile, UseGuards, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('upload')
export class UploadController {
  constructor(private upload: UploadService) {}

  @UseGuards(AdminGuard)
  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder = 'products',
  ) {
    return this.upload.uploadImage(file, folder);
  }
}
