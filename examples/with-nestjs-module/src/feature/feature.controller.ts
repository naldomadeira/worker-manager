import { Controller, Get } from '@nestjs/common';
import { WorkerManagerBoard, InjectWorkerManager } from '@worker-manager/nestjs';

@Controller('my-feature')
export class FeatureController {
  constructor(
    //inject the Worker Manager instance using the provided decorator
    @InjectWorkerManager() private readonly boardInstance: WorkerManagerBoard
  ) {}

  @Get()
  getFeature() {
    // You can do anything from here with the boardInstance for example:

    //this.boardInstance.replaceQueues();
    //this.boardInstance.addQueue();
    //this.boardInstance.setQueues();

    return 'ok';
  }
}
