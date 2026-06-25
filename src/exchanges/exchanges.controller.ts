import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ExchangesService } from './exchanges.service';
import { CreateExchangeDto } from './dto/create-exchange.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('exchanges')
@ApiBearerAuth('access-token')
@Permission('exchanges')
@Controller('exchanges')
export class ExchangesController {
  constructor(private exchanges: ExchangesService) {}

  @Post()
  create(@Body() dto: CreateExchangeDto, @CurrentUser() user: any) {
    return this.exchanges.create(dto, user.id);
  }

  @Get('my')
  findByUser(@CurrentUser() user: any) {
    return this.exchanges.findByUser(user.id);
  }

  @Get('options/:orderItemId')
  getOptions(@Param('orderItemId') orderItemId: string, @CurrentUser() user: any) {
    return this.exchanges.getOptions(orderItemId, user.id);
  }

  @UseGuards(PermissionsGuard)
  @Get()
  findAll() {
    return this.exchanges.findAll();
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('exchange.status_change')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; admin_notes?: string },
  ) {
    return this.exchanges.updateStatus(id, body.status, body.admin_notes);
  }
}
