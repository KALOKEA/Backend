import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { VariantsService } from './variants.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { Public } from '../common/decorators/public.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('variants')
@ApiBearerAuth('access-token')
@Permission('products')
@Controller('variants')
export class VariantsController {
  constructor(private variants: VariantsService) {}

  @Public()
  @Get('product/:productId')
  findByProduct(@Param('productId') productId: string) {
    return this.variants.findByProduct(productId);
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('variant.create')
  @Post()
  create(@Body() dto: CreateVariantDto) {
    return this.variants.create(dto);
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('variant.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.variants.update(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('variant.delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.variants.remove(id);
  }
}
