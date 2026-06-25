import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReturnsService } from './returns.service';
import { CreateReturnDto } from './dto/create-return.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('returns')
@ApiBearerAuth('access-token')
@Permission('returns')
@Controller('returns')
export class ReturnsController {
  constructor(private returns: ReturnsService) {}

  @Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 return requests/min per IP
  @Post()
  create(@Body() dto: CreateReturnDto, @CurrentUser() user: any) {
    return this.returns.create(dto, user.id);
  }

  @Get('my')
  findByUser(@CurrentUser() user: any) {
    return this.returns.findByUser(user.id);
  }

  @UseGuards(PermissionsGuard)
  @Get()
  findAll() {
    return this.returns.findAll();
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('return.status_change')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; admin_notes?: string },
  ) {
    return this.returns.updateStatus(id, body.status, body.admin_notes);
  }
}
