<?php
declare(strict_types=1);
require_once __DIR__.'/../src/Recorder.php';
use Horus\Recorder;
use Horus\Scope;
function check(bool $condition,string $message):void{if(!$condition)throw new RuntimeException($message);}
$r=new Recorder('test');
$value=['n'=>1,'authorization'=>'hidden'];
$result=$r->trace('root',function(Scope $s)use($value){return $s->span('work',['value'=>$value],function(Scope $child)use($value){$child->checkpoint('value',$value);$next=$value;$next['n']=2;$child->expect('n unchanged',false,2,1);return $next;});});
check($result['n']===2,'return value');$c=$r->export();
check(!str_contains(json_encode($c),'hidden'),'redaction');
check($c['events'][1]['data']->inputs->value->n===1,'input snapshot');
check($c['events'][4]['data']->output->n===2,'output snapshot');
$error=new RuntimeException('private-message');
try{$r->trace('fails',function()use($error){throw $error;});}catch(Throwable $caught){check($caught===$error,'exception identity');}
check(!str_contains(json_encode($r->export()),'private-message'),'no raw exception text');
$limited=new Recorder('limits',['max_events'=>10,'max_value_bytes'=>128]);$limited->trace('root',function(Scope $s){for($n=0;$n<50;$n++)$s->checkpoint('value',str_repeat('x',5000));});
$c=$limited->export();check(count($c['events'])===10&&$c['dropped_events']>0&&$c['truncated_values']>0,'bounds');
$skip=new Recorder('skip',['sample_rate'=>0]);$skip->trace('none',fn(Scope $s)=>$s->checkpoint('n',1));check(count($skip->export()['events'])===0,'sampling');
$parallel=new Recorder('fiber');$run=function($n)use($parallel){$parallel->trace('fiber-'.$n,function(Scope $s)use($n){$s->span('work',['n'=>$n],function(Scope $child)use($n){Fiber::suspend();$child->checkpoint('n',$n);});});};
$a=new Fiber(fn()=>$run(1));$b=new Fiber(fn()=>$run(2));$a->start();$b->start();$b->resume();$a->resume();
$events=array_values(array_filter($parallel->export()['events'],fn($e)=>$e['kind']==='checkpoint'));check(count($events)===2&&$events[0]['trace_id']!==$events[1]['trace_id'],'Fiber correlation');
echo "PHP SDK checks passed: snapshots, redaction, exceptions, bounds, sampling, concurrent Fibers.\n";

$raw=new Recorder('raw',['redaction'=>false,'redact_keys'=>['title']]);
check((array)$raw->snapshot(['password'=>'sample','title'=>'example'])===['password'=>'sample','title'=>'example'],'disable key redaction');
$raw->addSource('raw','raw.php','$token = "sample";');
$raw->trace('request',fn(Scope $s)=>$s->checkpoint('token',['password'=>'sample']));
$rawCapture=$raw->export();
check($rawCapture['config']['redaction']===false,'export redaction option');
check($rawCapture['sources'][0]['content']==='$token = "sample";','disable source redaction');
check($rawCapture['events'][1]['data']->value->password==='sample','disable checkpoint redaction');
