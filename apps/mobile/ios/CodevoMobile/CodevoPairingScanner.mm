#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
#import <atomic>

enum class CodevoCaptureState { Ready, Starting, Finished };

@interface CodevoPairingCapture : UIViewController <AVCaptureMetadataOutputObjectsDelegate>
- (instancetype)initWithCompletion:(void (^)(NSDictionary *))completion;
- (void)cancel;
@end

@implementation CodevoPairingCapture {
  AVCaptureSession *_session;
  AVCaptureVideoPreviewLayer *_preview;
  dispatch_queue_t _captureQueue;
  void (^_completion)(NSDictionary *);
  std::atomic<CodevoCaptureState> _state;
}
- (instancetype)initWithCompletion:(void (^)(NSDictionary *))completion {
  if ((self = [super init])) {
    _completion = [completion copy];
    _state.store(CodevoCaptureState::Ready);
    _session = [AVCaptureSession new];
    _captureQueue = dispatch_queue_create("com.codevo.pairing-camera", DISPATCH_QUEUE_SERIAL);
    self.modalPresentationStyle = UIModalPresentationFullScreen;
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(active:) name:UIApplicationDidBecomeActiveNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(background:) name:UIApplicationDidEnterBackgroundNotification object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(captureFailed:) name:AVCaptureSessionRuntimeErrorNotification object:_session];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(captureFailed:) name:AVCaptureSessionWasInterruptedNotification object:_session];
  }
  return self;
}
- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }
- (void)viewDidLoad {
  [super viewDidLoad];
  self.view.backgroundColor = [UIColor colorWithRed:16.0/255 green:26.0/255 blue:26.0/255 alpha:1];
  _preview = [AVCaptureVideoPreviewLayer layerWithSession:_session];
  _preview.videoGravity = AVLayerVideoGravityResizeAspectFill;
  [self.view.layer addSublayer:_preview];
  UILabel *title = [UILabel new];
  title.text = @"Scan pairing QR";
  title.textColor = UIColor.whiteColor;
  title.font = [UIFont preferredFontForTextStyle:UIFontTextStyleTitle2];
  title.adjustsFontForContentSizeCategory = YES;
  title.numberOfLines = 0;
  UILabel *hint = [UILabel new];
  hint.text = @"Point at the QR printed by the Codevo server pairing command.";
  hint.textColor = UIColor.whiteColor;
  hint.font = [UIFont preferredFontForTextStyle:UIFontTextStyleBody];
  hint.adjustsFontForContentSizeCategory = YES;
  hint.numberOfLines = 0;
  UIStackView *instructions = [[UIStackView alloc] initWithArrangedSubviews:@[title, hint]];
  instructions.axis = UILayoutConstraintAxisVertical;
  instructions.spacing = 12;
  instructions.backgroundColor = [UIColor colorWithWhite:0 alpha:0.75];
  instructions.translatesAutoresizingMaskIntoConstraints = NO;
  [self.view addSubview:instructions];
  UIButton *cancel = [UIButton buttonWithType:UIButtonTypeSystem];
  [cancel setTitle:@"Cancel" forState:UIControlStateNormal];
  cancel.titleLabel.font = [UIFont preferredFontForTextStyle:UIFontTextStyleHeadline];
  cancel.titleLabel.adjustsFontForContentSizeCategory = YES;
  cancel.backgroundColor = [UIColor colorWithRed:37.0/255 green:69.0/255 blue:59.0/255 alpha:1];
  [cancel setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
  cancel.layer.cornerRadius = 8;
  cancel.translatesAutoresizingMaskIntoConstraints = NO;
  [cancel addTarget:self action:@selector(cancel) forControlEvents:UIControlEventTouchUpInside];
  [self.view addSubview:cancel];
  UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
  [NSLayoutConstraint activateConstraints:@[
    [instructions.topAnchor constraintEqualToAnchor:safe.topAnchor constant:24],
    [instructions.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:24],
    [instructions.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-24],
    [cancel.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor constant:24],
    [cancel.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-24],
    [cancel.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor constant:-24],
    [cancel.heightAnchor constraintGreaterThanOrEqualToConstant:52],
  ]];
}
- (void)viewDidLayoutSubviews {
  [super viewDidLayoutSubviews];
  _preview.frame = self.view.bounds;
  UIInterfaceOrientation orientation = self.view.window.windowScene.interfaceOrientation;
  AVCaptureConnection *connection = _preview.connection;
  if (connection.isVideoOrientationSupported) {
    switch (orientation) {
      case UIInterfaceOrientationLandscapeLeft: connection.videoOrientation = AVCaptureVideoOrientationLandscapeLeft; break;
      case UIInterfaceOrientationLandscapeRight: connection.videoOrientation = AVCaptureVideoOrientationLandscapeRight; break;
      case UIInterfaceOrientationPortraitUpsideDown: connection.videoOrientation = AVCaptureVideoOrientationPortraitUpsideDown; break;
      default: connection.videoOrientation = AVCaptureVideoOrientationPortrait; break;
    }
  }
}
- (void)viewDidAppear:(BOOL)animated {
  [super viewDidAppear:animated];
  if (_state.load() == CodevoCaptureState::Finished) return;
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  if (status == AVAuthorizationStatusNotDetermined) {
    __weak CodevoPairingCapture *weakSelf = self;
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
      dispatch_async(dispatch_get_main_queue(), ^{
        CodevoPairingCapture *capture = weakSelf;
        if (!capture || capture->_state.load() == CodevoCaptureState::Finished) return;
        if (granted) [capture startCapture];
        else [capture finish:@{@"kind":@"error", @"reason":@"permission"}];
      });
    }];
    return;
  }
  if (status != AVAuthorizationStatusAuthorized) {
    [self finish:@{@"kind":@"error", @"reason":@"permission"}];
    return;
  }
  [self startCapture];
}
- (void)startCapture {
  if (_state.load() == CodevoCaptureState::Finished) return;
  if (UIApplication.sharedApplication.applicationState != UIApplicationStateActive || !self.view.window) return;
  CodevoCaptureState expected = CodevoCaptureState::Ready;
  if (!_state.compare_exchange_strong(expected, CodevoCaptureState::Starting)) return;
  dispatch_async(_captureQueue, ^{
    if (self->_state.load() == CodevoCaptureState::Finished) return;
    AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithDeviceType:AVCaptureDeviceTypeBuiltInWideAngleCamera mediaType:AVMediaTypeVideo position:AVCaptureDevicePositionBack];
    NSError *error = nil;
    AVCaptureDeviceInput *input = device ? [AVCaptureDeviceInput deviceInputWithDevice:device error:&error] : nil;
    AVCaptureMetadataOutput *output = [AVCaptureMetadataOutput new];
    [self->_session beginConfiguration];
    BOOL available = input && !error && [self->_session canAddInput:input];
    if (available) {
      [self->_session addInput:input];
      available = [self->_session canAddOutput:output];
    }
    if (available) {
      [self->_session addOutput:output];
      available = [output.availableMetadataObjectTypes containsObject:AVMetadataObjectTypeQRCode];
    }
    if (available) {
      output.metadataObjectTypes = @[AVMetadataObjectTypeQRCode];
      [output setMetadataObjectsDelegate:self queue:dispatch_get_main_queue()];
    }
    [self->_session commitConfiguration];
    if (!available) {
      dispatch_async(dispatch_get_main_queue(), ^{ [self finish:@{@"kind":@"error", @"reason":@"unavailable"}]; });
      return;
    }
    if (self->_state.load() != CodevoCaptureState::Finished) [self->_session startRunning];
  });
}
- (void)metadataOutput:(AVCaptureMetadataOutput *)output didOutputMetadataObjects:(NSArray<__kindof AVMetadataObject *> *)objects fromConnection:(AVCaptureConnection *)connection {
  if (_state.load() == CodevoCaptureState::Finished) return;
  for (AVMetadataObject *object in objects) {
    if (![object isKindOfClass:AVMetadataMachineReadableCodeObject.class] || ![object.type isEqualToString:AVMetadataObjectTypeQRCode]) continue;
    NSString *value = ((AVMetadataMachineReadableCodeObject *)object).stringValue;
    [self finish:@{@"kind":@"result", @"value":value && value.length <= 16384 ? value : @""}];
    return;
  }
}
- (void)captureFailed:(NSNotification *)note {
  dispatch_async(dispatch_get_main_queue(), ^{ [self finish:@{@"kind":@"error", @"reason":@"unavailable"}]; });
}
- (void)cancel { [self finish:@{@"kind":@"cancelled"}]; }
- (void)background:(NSNotification *)note { [self cancel]; }
- (void)active:(NSNotification *)note {
  if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo] == AVAuthorizationStatusAuthorized) [self startCapture];
}
- (void)viewDidDisappear:(BOOL)animated {
  [super viewDidDisappear:animated];
  [self cancel];
}
- (void)finish:(NSDictionary *)result {
  if (_state.exchange(CodevoCaptureState::Finished) == CodevoCaptureState::Finished) return;
  void (^completion)(NSDictionary *) = _completion;
  _completion = nil;
  dispatch_async(_captureQueue, ^{
    [self->_session stopRunning];
    for (AVCaptureInput *input in self->_session.inputs) [self->_session removeInput:input];
    for (AVCaptureOutput *output in self->_session.outputs) [self->_session removeOutput:output];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self.presentingViewController) [self dismissViewControllerAnimated:YES completion:^{ completion(result); }];
      else completion(result);
    });
  });
}
@end

@interface CodevoPairingScanner : NSObject <RCTBridgeModule>
@end

@implementation CodevoPairingScanner {
  CodevoPairingCapture *_scanner;
}
RCT_EXPORT_MODULE(CodevoPairingScanner)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
RCT_EXPORT_METHOD(scan:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  UIViewController *presenter = RCTPresentedViewController();
  if (_scanner || !presenter || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
    reject(@"scanner_unavailable", @"QR scanner unavailable", nil);
    return;
  }
  __weak CodevoPairingScanner *weakSelf = self;
  _scanner = [[CodevoPairingCapture alloc] initWithCompletion:^(NSDictionary *result) {
    CodevoPairingScanner *module = weakSelf;
    if (module) module->_scanner = nil;
    resolve(result);
  }];
  [presenter presentViewController:_scanner animated:YES completion:nil];
}
RCT_EXPORT_METHOD(cancel) { [_scanner cancel]; }
- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_scanner cancel]; });
}
@end
