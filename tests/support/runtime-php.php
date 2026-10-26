<?php
declare(strict_types=1);
require_once __DIR__.'/../../packages/sdk-php/src/Recorder.php';
use Horus\Recorder;
use Horus\Scope;
$config=json_decode(stream_get_contents(STDIN)?:'{}',true,512,JSON_THROW_ON_ERROR);
$recorder=new Recorder('checkout-php',array_replace(['label'=>'PHP checkout'],$config));
$recorder->addSource('checkout.php','runtime-php.php',file_get_contents(__FILE__));
final class Checkout {
    public int $processed=0;
    public function submit(array $order,bool $reject):array {
        if($reject)throw new RuntimeException('Synthetic upstream rejection');
        $this->processed++;
        return ['status'=>'accepted','amount'=>$order['quantity']*1250,'currency'=>$order['currency']];
    }
}
foreach([['success',false,false],['transformed',true,false],['upstream_failure',false,true]] as [$name,$faulty,$reject]){
    try{
        $recorder->trace('checkout.'.$name,function(Scope $scope)use($faulty,$reject):array{
            $order=['id'=>'php-17','quantity'=>'2','currency'=>'SGD','authorization'=>'synthetic-private-value'];
            $normalized=$scope->span('checkout.normalize',['order'=>$order,'faulty'=>$faulty],function(Scope $child)use($order,$faulty):array{
                $child->checkpoint('order',$order);
                $result=array_replace($order,['quantity'=>(int)$order['quantity'],'currency'=>$faulty?'USD':$order['currency']]);
                $child->checkpoint('order',$result);
                $child->expect('currency preserved',$result['currency']===$order['currency'],$result['currency'],$order['currency']);
                return $result;
            },'checkout.php');
            return $scope->method(new Checkout(),'submit',[$normalized,$reject],['processed']);
        });
    }catch(RuntimeException){}
}
echo json_encode($recorder->export(),JSON_THROW_ON_ERROR);
