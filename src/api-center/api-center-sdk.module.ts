import { Global, Module } from '@nestjs/common';
import { ApiCenterSdkService } from './api-center-sdk.service.js';

@Global()
@Module({
  providers: [ApiCenterSdkService],
  exports: [ApiCenterSdkService],
})
export class ApiCenterSdkModule {}
