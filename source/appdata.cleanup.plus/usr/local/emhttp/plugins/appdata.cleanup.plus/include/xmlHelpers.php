 <?PHP

class TypeConverter {

const XML_NONE = 0;

const XML_MERGE = 1;

const XML_GROUP = 2;

const XML_OVERWRITE = 3;

public static function is($data) {
		if (self::isArray($data)) {
			return 'array';

		} else if (self::isObject($data)) {
			return 'object';

		} else if (self::isJson($data)) {
			return 'json';

		} else if (self::isSerialized($data)) {
			return 'serialized';

		} else if (self::isXml($data)) {
			return 'xml';
		}

		return 'other';
	}

public static function isArray($data) {
		return is_array($data);
	}

public static function isJson($data) {
		return (@json_decode($data) !== null);
	}

public static function isObject($data) {
		return is_object($data);
	}

public static function isSerialized($data) {
		$ser = @unserialize($data);

		return ($ser !== false) ? $ser : false;
	}

public static function isXml($data) {
		$xml = @simplexml_load_string($data);

		return ($xml instanceof SimpleXmlElement) ? $xml : false;
	}

public static function toArray($resource) {
		if (self::isArray($resource)) {
			return $resource;

		} else if (self::isObject($resource)) {
			return self::buildArray($resource);

		} else if (self::isJson($resource)) {
			return json_decode($resource, true);

		} else if ($ser = self::isSerialized($resource)) {
			return self::toArray($ser);

		} else if ($xml = self::isXml($resource)) {
			return self::xmlToArray($xml);
		}

		return $resource;
	}

public static function toJson($resource) {
		if (self::isJson($resource)) {
			return $resource;
		}

		if ($xml = self::isXml($resource)) {
			$resource = self::xmlToArray($xml);

		} else if ($ser = self::isSerialized($resource)) {
			$resource = $ser;
		}

		return json_encode($resource);
	}

public static function toObject($resource) {
		if (self::isObject($resource)) {
			return $resource;

		} else if (self::isArray($resource)) {
			return self::buildObject($resource);

		} else if (self::isJson($resource)) {
			return json_decode($resource);

		} else if ($ser = self::isSerialized($resource)) {
			return self::toObject($ser);

		} else if ($xml = self::isXml($resource)) {
			return $xml;
		}

		return $resource;
	}

public static function toSerialize($resource) {
		if (!self::isArray($resource)) {
			$resource = self::toArray($resource);
		}

		return serialize($resource);
	}

public static function toXml($resource, $root = 'root') {
		if (self::isXml($resource)) {
			return $resource;
		}

		$array = self::toArray($resource);

		if (!empty($array)) {
			$xml = simplexml_load_string('<?xml version="1.0" encoding="utf-8"?><'. $root .'></'. $root .'>');
			$response = self::buildXml($xml, $array);

			return $response->asXML();
		}

		return $resource;
	}

public static function buildArray($object) {
		$array = array();

		foreach ($object as $key => $value) {
			if (is_object($value)) {
				$array[$key] = self::buildArray($value);
			} else {
				$array[$key] = $value;
			}
		}

		return $array;
	}

public static function buildObject($array) {
		$obj = new \stdClass();

		foreach ($array as $key => $value) {
			if (is_array($value)) {
				$obj->{$key} = self::buildObject($value);
			} else {
				$obj->{$key} = $value;
			}
		}

		return $obj;
	}

public static function buildXml(&$xml, $array) {
		if (is_array($array)) {
			foreach ($array as $key => $value) {
				 
				if (!is_array($value)) {
					$xml->addChild($key, $value);
					continue;
				}

if (isset($value[0])) {
					foreach ($value as $kValue) {
						if (is_array($kValue)) {
							self::buildXml($xml, array($key => $kValue));
						} else {
							$xml->addChild($key, $kValue);
						}
					}

} else if (isset($value['@attributes'])) {
					if (is_array($value['value'])) {
						$node = $xml->addChild($key);
						self::buildXml($node, $value['value']);
					} else {
						$node = $xml->addChild($key, $value['value']);
					}

					if (!empty($value['@attributes'])) {
						foreach ($value['@attributes'] as $aKey => $aValue) {
							$node->addAttribute($aKey, $aValue);
						}
					}

} else if (isset($value['value'])) {
					$node = $xml->addChild($key, $value['value']);
					unset($value['value']);

					if (!empty($value)) {
						foreach ($value as $aKey => $aValue) {
							if (is_array($aValue)) {
								self::buildXml($node, array($aKey => $aValue));
							} else {
								$node->addAttribute($aKey, $aValue);
							}
						}
					}

} else {
					$node = $xml->addChild($key);

					if (!empty($value)) {
						foreach ($value as $aKey => $aValue) {
							if (is_array($aValue)) {
								self::buildXml($node, array($aKey => $aValue));
							} else {
								$node->addChild($aKey, $aValue);
							}
						}
					}
				}
			}
		}

		return $xml;
	}

public static function xmlToArray($xml, $format = self::XML_GROUP) {
		if (is_string($xml)) {
			$xml = @simplexml_load_string($xml);
		}
		if ( ! $xml ) { return false; }
		if (count($xml->children()) <= 0) {
			return (string)$xml;
		}

		$array = array();

		foreach ($xml->children() as $element => $node) {
			$data = array();

			if (!isset($array[$element])) {
 
				$array[$element] = [];
			}

			if (!$node->attributes() || $format === self::XML_NONE) {
				$data = self::xmlToArray($node, $format);

			} else {
				switch ($format) {
					case self::XML_GROUP:
						$data = array(
							'@attributes' => array(),
							'value' => (string)$node
						);

						if (count($node->children()) > 0) {
							$data['value'] = self::xmlToArray($node, $format);
						}

						foreach ($node->attributes() as $attr => $value) {
							$data['@attributes'][$attr] = (string)$value;
						}
					break;

					case self::XML_MERGE:
					case self::XML_OVERWRITE:
						if ($format === self::XML_MERGE) {
							if (count($node->children()) > 0) {
								$data = $data + self::xmlToArray($node, $format);
							} else {
								$data['value'] = (string)$node;
							}
						}

						foreach ($node->attributes() as $attr => $value) {
							$data[$attr] = (string)$value;
						}
					break;
				}
			}

			if (count($xml->{$element}) > 1) {
				$array[$element][] = $data;
			} else {
				$array[$element] = $data;
			}
		}

		return $array;
	}

public static function utf8Encode($data) {
		if (is_string($data)) {
			return utf8_encode($data);

		} else if (is_array($data)) {
			foreach ($data as $key => $value) {
				$data[utf8_encode($key)] = self::utf8Encode($value);
			}

		} else if (is_object($data)) {
			foreach ($data as $key => $value) {
				$data->{$key} = self::utf8Encode($value);
			}
		}

		return $data;
	}

public static function utf8Decode($data) {
		if (is_string($data)) {
			return utf8_decode($data);

		} else if (is_array($data)) {
			foreach ($data as $key => $value) {
				$data[utf8_decode($key)] = self::utf8Decode($value);
			}

		} else if (is_object($data)) {
			foreach ($data as $key => $value) {
				$data->{$key} = self::utf8Decode($value);
			}
		}

		return $data;
	}

}

class Array2XML {
		private static $xml = null;
	private static $encoding = 'UTF-8';

public static function init($version = '1.0', $encoding = 'UTF-8', $format_output = true) {
				self::$xml = new DomDocument($version, $encoding);
				self::$xml->formatOutput = $format_output;
		self::$encoding = $encoding;
		}

public static function &createXML($node_name, $arr=array()) {
				$xml = self::getXMLRoot();
				$xml->appendChild(self::convert($node_name, $arr));
				self::$xml = null;     
				return $xml;
		}

private static function &convert($node_name, $arr=array()) {
				 
				$xml = self::getXMLRoot();
				$node = $xml->createElement($node_name);
				if(is_array($arr)){
						 
						if(isset($arr['@attributes'])) {
								foreach($arr['@attributes'] as $key => $value) {
										if(!self::isValidTagName($key)) {
												throw new Exception('[Array2XML] Illegal character in attribute name. attribute: '.$key.' in node: '.$node_name);
										}
										$node->setAttribute($key, self::bool2str($value));
								}
								unset($arr['@attributes']);  
						}

if(isset($arr['@value'])) {
								$node->appendChild($xml->createTextNode(self::bool2str($arr['@value'])));
								unset($arr['@value']);     
								 
								return $node;
						} else if(isset($arr['@cdata'])) {
								$node->appendChild($xml->createCDATASection(self::bool2str($arr['@cdata'])));
								unset($arr['@cdata']);     
								 
								return $node;
						}
				}
				 
				if(is_array($arr)){
						 
						foreach($arr as $key=>$value){
								if(!self::isValidTagName($key)) {
										throw new Exception('[Array2XML] Illegal character in tag name. tag: '.$key.' in node: '.$node_name);
								}
								if(is_array($value) && is_numeric(key($value))) {

foreach($value as $k=>$v){
												$node->appendChild(self::convert($key, $v));
										}
								} else {
										 
										$node->appendChild(self::convert($key, $value));
								}
								unset($arr[$key]);  
						}
				}

if(!is_array($arr)) {
						$node->appendChild($xml->createTextNode(self::bool2str($arr)));
				}
				return $node;
		}

private static function getXMLRoot(){
				if(empty(self::$xml)) {
						self::init();
				}
				return self::$xml;
		}

private static function bool2str($v){
				 
				$v = $v === true ? 'true' : $v;
				$v = $v === false ? 'false' : $v;
				return $v;
		}

private static function isValidTagName($tag){
				$pattern = '/^[a-z_]+[a-z0-9\:\-\.\_]*[^:]*$/i';
				return preg_match($pattern, $tag, $matches) && $matches[0] == $tag;
		}
}

class XML2Array {

		private static $xml = null;
	private static $encoding = 'UTF-8';

public static function init($version = '1.0', $encoding = 'UTF-8', $format_output = true) {
				self::$xml = new DOMDocument($version, $encoding);
				self::$xml->formatOutput = $format_output;
		self::$encoding = $encoding;
		}

public static function &createArray($input_xml) {
				$xml = self::getXMLRoot();
		if(is_string($input_xml)) {
			$parsed = $xml->loadXML($input_xml);
			if(!$parsed) {
				 
				return [];
			}
		} else {
			if(get_class($input_xml) != 'DOMDocument') {
				throw new Exception('[XML2Array] The input XML object should be of type: DOMDocument.');
			}
			$xml = self::$xml = $input_xml;
		}
		$array[$xml->documentElement->tagName] = self::convert($xml->documentElement);
				self::$xml = null;     
				return $array;
		}

private static function &convert($node) {
		$output = array();

		switch ($node->nodeType) {
			case XML_CDATA_SECTION_NODE:
				$output['@cdata'] = trim($node->textContent);
				break;

			case XML_TEXT_NODE:
				$output = trim($node->textContent);
				break;

			case XML_ELEMENT_NODE:

for ($i=0, $m=$node->childNodes->length; $i<$m; $i++) {
					$child = $node->childNodes->item($i);
					$v = self::convert($child);
					if(isset($child->tagName)) {
						$t = $child->tagName;

if(!isset($output[$t])) {
							$output[$t] = array();
						}
						$output[$t][] = $v;
					} else {
						 
						if($v !== '') {
							$output = $v;
						}
					}
				}

				if(is_array($output)) {
					 
					foreach ($output as $t => $v) {
						if(is_array($v) && count($v)==1) {
							$output[$t] = $v[0];
						}
					}
					if(empty($output)) {
						 
						$output = '';
					}
				}

if($node->attributes->length) {
					$a = array();
					foreach($node->attributes as $attrName => $attrNode) {
						$a[$attrName] = (string) $attrNode->value;
					}
					 
					if(!is_array($output)) {
						$output = array('@value' => $output);
					}
					$output['@attributes'] = $a;
				}
				break;
		}
		return $output;
		}

private static function getXMLRoot(){
				if(empty(self::$xml)) {
						self::init();
				}
				return self::$xml;
		}
}
?>